/** In-memory Drive for tests: folders by path, files with bytes as strings. */
import { DriveError, type DriveApi, type DriveFile } from '../api';

export interface FakeFile extends DriveFile {
  parent: string;
  content: string;
  mimeType: string;
}

export class FakeDrive implements DriveApi {
  files = new Map<string, FakeFile>();
  folders = new Map<string, string>();
  /** Local "disk": uri → content (shared with the fake ClipFiles). */
  constructor(
    readonly disk: Map<string, string> = new Map(),
    public clock: () => number = () => 1_763_000_000_000,
  ) {}
  failNext = 0;
  calls: string[] = [];
  private n = 0;

  private maybeFail(what: string) {
    this.calls.push(what);
    if (this.failNext > 0) {
      this.failNext--;
      throw new DriveError(0, 'network down');
    }
  }

  async folder(path: readonly string[]) {
    this.maybeFail(`folder ${path.join('/')}`);
    const key = path.join('/');
    let id = this.folders.get(key);
    if (!id) {
      id = `folder-${++this.n}`;
      this.folders.set(key, id);
    }
    return id;
  }

  private add(name: string, parent: string, content: string, mimeType: string) {
    const id = `file-${++this.n}`;
    this.files.set(id, { id, name, parent, content, mimeType, size: content.length, createdTime: this.clock() + this.n });
    return { id, size: content.length };
  }

  async uploadFile(uri: string, name: string, mimeType: string, parent: string) {
    this.maybeFail(`upload ${name}`);
    const content = this.disk.get(uri);
    if (content === undefined) throw new Error(`no local file ${uri}`);
    return this.add(name, parent, content, mimeType);
  }

  async uploadText(text: string, name: string, mimeType: string, parent: string) {
    this.maybeFail(`uploadText ${name}`);
    return this.add(name, parent, text, mimeType);
  }

  async list(parent: string) {
    this.maybeFail(`list ${parent}`);
    return [...this.files.values()].filter((f) => f.parent === parent).sort((a, b) => b.createdTime - a.createdTime);
  }

  async download(id: string, uri: string) {
    this.maybeFail(`download ${id}`);
    const f = this.files.get(id);
    if (!f) throw new DriveError(404, 'not found');
    this.disk.set(uri, f.content);
  }

  async downloadText(id: string) {
    this.maybeFail(`downloadText ${id}`);
    const f = this.files.get(id);
    if (!f) throw new DriveError(404, 'not found');
    return f.content;
  }

  async remove(id: string) {
    this.maybeFail(`remove ${id}`);
    this.files.delete(id);
  }

  async removeFolder(path: readonly string[]) {
    this.maybeFail(`removeFolder ${path.join('/')}`);
    const prefix = path.join('/');
    const gone = [...this.folders.entries()].filter(([k]) => k === prefix || k.startsWith(`${prefix}/`));
    for (const [k, id] of gone) {
      this.folders.delete(k);
      for (const f of [...this.files.values()]) if (f.parent === id) this.files.delete(f.id);
    }
    return gone.length > 0;
  }

  async usage() {
    return [...this.files.values()].reduce((a, f) => a + f.size, 0);
  }
}

/** ClipFiles over the same fake disk; compress turns x.wav into x.aac (content shrunk). */
export function fakeFiles(disk: Map<string, string>, opts: { canCompress?: boolean; brokenWav?: boolean } = {}) {
  return {
    exists: async (uri: string) => disk.has(uri),
    remove: async (uri: string) => {
      disk.delete(uri);
    },
    compress: async (uri: string) => {
      if (opts.brokenWav) throw new Error('not a WAV file');
      if (opts.canCompress === false) return null;
      const out = uri.replace(/\.wav$/i, '.aac');
      disk.set(out, `aac(${disk.get(uri)})`);
      return out;
    },
  };
}
