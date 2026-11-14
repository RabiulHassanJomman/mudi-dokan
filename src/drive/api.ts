/**
 * Google Drive, as the rest of step 8 sees it. Pure TS: the REST client (rest.ts) and the
 * tests' fake both implement it. Scope drive.file: the app sees only files it made, on any
 * phone signed in to the shop account.
 */

export interface DriveFile {
  id: string;
  name: string;
  /** Bytes (0 for folders). */
  size: number;
  /** ms */
  createdTime: number;
}

export interface Uploaded {
  id: string;
  size: number;
}

export interface DriveApi {
  /** Folder id for a path like ['Mudi Dokan', 'Audio', '2026-11']; created if missing. */
  folder(path: readonly string[]): Promise<string>;
  /** A file on this phone (file:// URI) into a folder. */
  uploadFile(localUri: string, name: string, mimeType: string, parentId: string): Promise<Uploaded>;
  /** Text (the backup JSON) into a folder. */
  uploadText(text: string, name: string, mimeType: string, parentId: string): Promise<Uploaded>;
  /** Files directly in a folder, newest first. */
  list(parentId: string): Promise<DriveFile[]>;
  /** Into a local file (file:// URI), replacing it. */
  download(fileId: string, localUri: string): Promise<void>;
  downloadText(fileId: string): Promise<string>;
  /** Gone already (404) counts as done. */
  remove(fileId: string): Promise<void>;
  /** Bytes of every file the app keeps on Drive (audio + backups). */
  usage(): Promise<number>;
}

/** Drive said no (HTTP status), or the network failed (status 0). */
export class DriveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

export const ROOT_FOLDER = 'Mudi Dokan';
export const AUDIO_FOLDER = 'Audio';
export const BACKUP_FOLDER = 'Backup';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "2026-11" for the month the clip was made (phone's local time). */
export function monthOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** "2026-11-14_2130" (local time) — for file names that sort by time. */
export function stamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

export const audioPath = (createdAt: number) => [ROOT_FOLDER, AUDIO_FOLDER, monthOf(createdAt)];
export const backupPath = [ROOT_FOLDER, BACKUP_FOLDER] as const;
