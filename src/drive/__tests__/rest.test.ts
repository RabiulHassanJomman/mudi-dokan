import { DriveError } from '../api';
import { q, restDrive, type RestDeps } from '../rest';

type Req = { url: string; method: string; headers: Record<string, string>; body?: string };

function fakeHttp(handler: (r: Req) => { status: number; body?: unknown; headers?: Record<string, string> }) {
  const reqs: Req[] = [];
  const cache = new Map<string, string>();
  let token = 't1';
  const deps: RestDeps = {
    token: async () => token,
    refresh: async () => (token = 't2'),
    fetch: async (url, init = {}) => {
      const r: Req = { url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body };
      reqs.push(r);
      const res = handler(r);
      const text = res.body === undefined ? '' : typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
      return { status: res.status, ok: res.status >= 200 && res.status < 300, text: async () => text, headers: { get: (n: string) => res.headers?.[n.toLowerCase()] ?? null } };
    },
    putFile: async (url, uri, headers) => {
      reqs.push({ url, method: 'PUT', headers, body: uri });
      return { status: 200, body: JSON.stringify({ id: 'F1', size: '4000' }) };
    },
    downloadTo: async (url, _uri, headers) => {
      reqs.push({ url, method: 'GET', headers });
      return { status: 200 };
    },
    cache: {
      get: async (k) => cache.get(k) ?? null,
      set: async (k, v) => {
        if (k === '*') cache.clear();
        else if (v) cache.set(k, v);
      },
    },
  };
  return { deps, reqs, cache };
}

describe('Drive REST client', () => {
  it('finds or makes each folder of the path once, then uses the cache', async () => {
    let made = 0;
    const h = fakeHttp((r) => {
      if (r.method === 'GET' && r.url.includes('/files?q=')) {
        const query = decodeURIComponent(r.url.split('q=')[1]!.split('&')[0]!);
        return { status: 200, body: { files: query.includes("'Mudi Dokan'") ? [{ id: 'root-folder' }] : [] } };
      }
      if (r.method === 'POST') return { status: 200, body: { id: `new-${++made}` } };
      return { status: 500 };
    });
    const api = restDrive(h.deps);
    expect(await api.folder(['Mudi Dokan', 'Audio', '2026-11'])).toBe('new-2');
    const posts = h.reqs.filter((r) => r.method === 'POST').map((r) => JSON.parse(r.body!));
    expect(posts).toEqual([
      { name: 'Audio', mimeType: 'application/vnd.google-apps.folder', parents: ['root-folder'] },
      { name: '2026-11', mimeType: 'application/vnd.google-apps.folder', parents: ['new-1'] },
    ]);
    const n = h.reqs.length;
    expect(await api.folder(['Mudi Dokan', 'Audio', '2026-11'])).toBe('new-2');
    expect(h.reqs.length).toBe(n);
  });

  it('uploads a file through a resumable session', async () => {
    const h = fakeHttp(() => ({ status: 200, headers: { location: 'https://upload/session1' } }));
    const r = await restDrive(h.deps).uploadFile('file:///doc/a.aac', 'a.aac', 'audio/aac', 'P');
    expect(r).toEqual({ id: 'F1', size: 4000 });
    expect(h.reqs[0]).toMatchObject({ method: 'POST', headers: { 'X-Upload-Content-Type': 'audio/aac', Authorization: 'Bearer t1' } });
    expect(JSON.parse(h.reqs[0]!.body!)).toEqual({ name: 'a.aac', parents: ['P'], mimeType: 'audio/aac' });
    expect(h.reqs[1]).toMatchObject({ url: 'https://upload/session1', method: 'PUT', body: 'file:///doc/a.aac' });
  });

  it('a refused token (401) is refreshed once', async () => {
    const h = fakeHttp((r) => (r.headers.Authorization === 'Bearer t1' ? { status: 401 } : { status: 204 }));
    await restDrive(h.deps).remove('F1');
    expect(h.reqs.map((r) => r.headers.Authorization)).toEqual(['Bearer t1', 'Bearer t2']);
  });

  it('delete: already gone (404) is fine; other errors throw with the status', async () => {
    await expect(restDrive(fakeHttp(() => ({ status: 404 })).deps).remove('F1')).resolves.toBeUndefined();
    await expect(restDrive(fakeHttp(() => ({ status: 403, body: 'quota' })).deps).remove('F1')).rejects.toMatchObject({ status: 403 });
  });

  it('a 404 on upload (folder deleted on Drive) forgets the cached folders', async () => {
    const h = fakeHttp(() => ({ status: 404, body: 'parent not found' }));
    h.cache.set('Mudi Dokan', 'gone');
    await expect(restDrive(h.deps).uploadFile('file:///a', 'a', 'audio/aac', 'gone')).rejects.toBeInstanceOf(DriveError);
    expect(h.cache.size).toBe(0);
  });

  it('network failure → DriveError status 0 (retried by the queue)', async () => {
    const h = fakeHttp(() => ({ status: 200 }));
    h.deps.fetch = async () => {
      throw new Error('Network request failed');
    };
    await expect(restDrive(h.deps).usage()).rejects.toMatchObject({ status: 0 });
  });

  it('usage adds the sizes over pages; list maps files', async () => {
    let page = 0;
    const h = fakeHttp(() =>
      ++page === 1
        ? { status: 200, body: { files: [{ size: '100' }, { size: '50' }], nextPageToken: 'p2' } }
        : { status: 200, body: { files: [{ size: '7' }] } },
    );
    expect(await restDrive(h.deps).usage()).toBe(157);
    const l = fakeHttp(() => ({ status: 200, body: { files: [{ id: 'a', name: 'x.json', size: '9', createdTime: '2026-11-14T15:00:00Z' }] } }));
    expect(await restDrive(l.deps).list('P')).toEqual([{ id: 'a', name: 'x.json', size: 9, createdTime: Date.parse('2026-11-14T15:00:00Z') }]);
  });

  it("escapes quotes in queries", () => {
    expect(q("Rahim's")).toBe("'Rahim\\'s'");
  });

  it('removeFolder: finds the folder by path without creating it, deletes it (and any second one); none → false', async () => {
    const deleted: string[] = [];
    let calls = 0;
    const h = fakeHttp((r) => {
      if (r.method === 'DELETE') {
        deleted.push(r.url.split('/files/')[1]!);
        return { status: 204 };
      }
      const query = decodeURIComponent(r.url.split('q=')[1]!.split('&')[0]!);
      if (query.includes("'Mudi Dokan'")) return { status: 200, body: { files: ++calls <= 2 ? [{ id: `md-${calls}` }] : [] } };
      return { status: 200, body: { files: [] } };
    });
    h.cache.set('Mudi Dokan', 'md-1');
    expect(await restDrive(h.deps).removeFolder(['Mudi Dokan'])).toBe(true);
    expect(deleted).toEqual(['md-1', 'md-2']);
    expect(h.reqs.some((r) => r.method === 'POST')).toBe(false); // nothing was created to be deleted
    expect(h.cache.size).toBe(0);
    expect(await restDrive(fakeHttp(() => ({ status: 200, body: { files: [] } })).deps).removeFolder(['Mudi Dokan'])).toBe(false);
  });
});
