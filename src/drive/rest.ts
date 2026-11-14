/**
 * DriveApi on the Drive v3 REST API. Pure TS: fetch, the access token and moving a file's
 * bytes (expo-file-system on the phone) are passed in, so the request logic is tested with a
 * fake fetch.
 */
import { DriveError, type DriveApi, type DriveFile, type Uploaded } from './api';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface HttpResult {
  status: number;
  body: string;
}

export interface RestDeps {
  /** Access token with the drive.file scope. */
  token(): Promise<string>;
  /** The token was refused (401): drop it and get a fresh one. */
  refresh(old: string): Promise<string>;
  fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
    status: number;
    ok: boolean;
    text(): Promise<string>;
    headers: { get(name: string): string | null };
  }>;
  /** PUT a local file's bytes to `url`. */
  putFile(url: string, localUri: string, headers: Record<string, string>): Promise<HttpResult>;
  /** GET `url` into a local file. */
  downloadTo(url: string, localUri: string, headers: Record<string, string>): Promise<{ status: number }>;
  /** Folder ids by path ("Mudi Dokan/Audio/2026-11"), so each isn't looked up every time. */
  cache?: { get(key: string): Promise<string | null>; set(key: string, id: string | null): Promise<void> };
}

/** ' and \ escaped for a Drive query string. */
export const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const toFile = (f: { id: string; name: string; size?: string; createdTime?: string }): DriveFile => ({
  id: f.id,
  name: f.name,
  size: Number(f.size ?? 0),
  createdTime: f.createdTime ? Date.parse(f.createdTime) : 0,
});

export function restDrive(d: RestDeps): DriveApi {
  /** fetch with the token; one retry with a fresh token on 401. */
  async function call(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
    let token = await d.token();
    for (let i = 0; ; i++) {
      let r;
      try {
        r = await d.fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
      } catch (e) {
        throw new DriveError(0, e instanceof Error ? e.message : String(e));
      }
      if (r.status === 401 && i === 0) {
        token = await d.refresh(token);
        continue;
      }
      return r;
    }
  }

  async function json<T>(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<T> {
    const r = await call(url, init);
    const text = await r.text();
    if (!r.ok) throw new DriveError(r.status, `Drive ${r.status}: ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  async function findOrMakeFolder(name: string, parent: string): Promise<string> {
    const query = `name = ${q(name)} and mimeType = '${FOLDER_MIME}' and trashed = false and ${q(parent)} in parents`;
    const found = await json<{ files: { id: string }[] }>(
      `${API}/files?q=${encodeURIComponent(query)}&orderBy=createdTime&fields=files(id)&pageSize=10`,
    );
    if (found.files.length) return found.files[0]!.id;
    const made = await json<{ id: string }>(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
    });
    return made.id;
  }

  /** The folder at `path` if it exists (never creates one). */
  async function findFolder(path: readonly string[]): Promise<string | null> {
    let parent = 'root';
    for (const name of path) {
      const query = `name = ${q(name)} and mimeType = '${FOLDER_MIME}' and trashed = false and ${q(parent)} in parents`;
      const found = await json<{ files: { id: string }[] }>(`${API}/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=10`);
      if (!found.files.length) return null;
      parent = found.files[0]!.id;
    }
    return parent;
  }

  /** A 404 on upload: the folder was deleted on Drive; forget it so the next try makes it again. */
  async function forgetFolders(): Promise<void> {
    if (!d.cache) return;
    await d.cache.set('*', null);
  }

  const api: DriveApi = {
    async folder(path) {
      let parent = 'root';
      for (let i = 0; i < path.length; i++) {
        const key = path.slice(0, i + 1).join('/');
        const hit = d.cache ? await d.cache.get(key) : null;
        if (hit) {
          parent = hit;
          continue;
        }
        parent = await findOrMakeFolder(path[i]!, parent);
        await d.cache?.set(key, parent);
      }
      return parent;
    },

    async uploadFile(localUri, name, mimeType, parentId): Promise<Uploaded> {
      const start = await call(`${UPLOAD}/files?uploadType=resumable&fields=id,size`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType },
        body: JSON.stringify({ name, parents: [parentId], mimeType }),
      });
      if (!start.ok) {
        if (start.status === 404) await forgetFolders();
        throw new DriveError(start.status, `Drive ${start.status}: ${(await start.text()).slice(0, 200)}`);
      }
      const session = start.headers.get('location') ?? start.headers.get('Location');
      if (!session) throw new DriveError(0, 'Drive: no upload session');
      let put: HttpResult;
      try {
        put = await d.putFile(session, localUri, { 'Content-Type': mimeType });
      } catch (e) {
        throw new DriveError(0, e instanceof Error ? e.message : String(e));
      }
      if (put.status < 200 || put.status >= 300) throw new DriveError(put.status, `Drive upload ${put.status}: ${put.body.slice(0, 200)}`);
      const f = JSON.parse(put.body) as { id: string; size?: string };
      return { id: f.id, size: Number(f.size ?? 0) };
    },

    async uploadText(text, name, mimeType, parentId) {
      const b = `mudi${Date.now().toString(36)}`;
      const body =
        `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parentId], mimeType })}\r\n` +
        `--${b}\r\nContent-Type: ${mimeType}; charset=UTF-8\r\n\r\n${text}\r\n--${b}--`;
      try {
        const f = await json<{ id: string; size?: string }>(`${UPLOAD}/files?uploadType=multipart&fields=id,size`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${b}` },
          body,
        });
        return { id: f.id, size: Number(f.size ?? 0) };
      } catch (e) {
        if (e instanceof DriveError && e.status === 404) await forgetFolders();
        throw e;
      }
    },

    async list(parentId) {
      const out: DriveFile[] = [];
      let page = '';
      do {
        const query = `${q(parentId)} in parents and trashed = false`;
        const r = await json<{ files: { id: string; name: string; size?: string; createdTime?: string }[]; nextPageToken?: string }>(
          `${API}/files?q=${encodeURIComponent(query)}&orderBy=createdTime desc&pageSize=100` +
            `&fields=nextPageToken,files(id,name,size,createdTime)${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`,
        );
        out.push(...r.files.map(toFile));
        page = r.nextPageToken ?? '';
      } while (page);
      return out;
    },

    async download(fileId, localUri) {
      let token = await d.token();
      let r = await d.downloadTo(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, localUri, { Authorization: `Bearer ${token}` });
      if (r.status === 401) {
        token = await d.refresh(token);
        r = await d.downloadTo(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, localUri, { Authorization: `Bearer ${token}` });
      }
      if (r.status < 200 || r.status >= 300) throw new DriveError(r.status, `Drive download ${r.status}`);
    },

    async downloadText(fileId) {
      const r = await call(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
      const text = await r.text();
      if (!r.ok) throw new DriveError(r.status, `Drive ${r.status}: ${text.slice(0, 200)}`);
      return text;
    },

    async remove(fileId) {
      const r = await call(`${API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
      if (r.ok || r.status === 404) return;
      throw new DriveError(r.status, `Drive delete ${r.status}: ${(await r.text()).slice(0, 200)}`);
    },

    async removeFolder(path) {
      // every folder of that name (a second "Mudi Dokan" can exist if two phones made it at once)
      let removed = false;
      for (;;) {
        const id = await findFolder(path);
        if (!id) break;
        await api.remove(id);
        removed = true;
      }
      if (d.cache) await d.cache.set('*', null);
      return removed;
    },

    async usage() {
      let total = 0;
      let page = '';
      do {
        const query = `trashed = false and mimeType != '${FOLDER_MIME}'`;
        const r = await json<{ files: { size?: string }[]; nextPageToken?: string }>(
          `${API}/files?q=${encodeURIComponent(query)}&pageSize=1000&fields=nextPageToken,files(size)` +
            `${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`,
        );
        total += r.files.reduce((a, f) => a + Number(f.size ?? 0), 0);
        page = r.nextPageToken ?? '';
      } while (page);
      return total;
    },
  };
  return api;
}
