import {
  constants,
  access,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import APIError from '../errorHandling/apiError.js';
import { decryptBackup, encryptBackup } from '../utils/backupCrypto.js';
import UserService from './userService.js';

const KEEP = 30;
const NAME_RE = /^myfin-backup-(\d{4}-\d{2}-\d{2}-\d{4})(?:-(\d+))?\.myfin$/;
const USERNAME_RE = /^[A-Za-z0-9._-]+$/;
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MIN_PASSWORD = 8;

type Status = { available: boolean; reason?: string };

const status = async (): Promise<Status> => {
  const dir = process.env.BACKUP_DIR;
  if (!dir) return { available: false, reason: 'BACKUP_DIR is not configured' };
  try {
    if (!(await stat(dir)).isDirectory()) {
      return { available: false, reason: 'BACKUP_DIR is not a folder' };
    }
  } catch {
    return { available: false, reason: 'BACKUP_DIR does not exist' };
  }
  try {
    await access(dir, constants.W_OK);
  } catch {
    return { available: false, reason: 'BACKUP_DIR is not writable' };
  }
  return { available: true };
};

const requireDir = async () => {
  const s = await status();
  if (!s.available) throw APIError.badRequest(s.reason ?? 'Backup folder unavailable');
  return process.env.BACKUP_DIR as string;
};

/** Each user's backups live in BACKUP_DIR/<username>/; the name is restricted to a safe charset. */
const userDirOf = (root: string, username: string) => {
  if (
    typeof username !== 'string' ||
    username === '.' ||
    username === '..' ||
    !USERNAME_RE.test(username)
  ) {
    throw APIError.badRequest('Username cannot be used as a backup folder name');
  }
  return path.join(root, username);
};

/** Newest first: by the timestamp in the name, then by the numeric collision suffix. */
const compareNewestFirst = (a: string, b: string) => {
  const ma = NAME_RE.exec(a);
  const mb = NAME_RE.exec(b);
  if (!ma || !mb) return 0;
  if (ma[1] !== mb[1]) return ma[1] < mb[1] ? 1 : -1;
  return Number(mb[2] ?? 1) - Number(ma[2] ?? 1);
};

const listIn = async (dir: string) => {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => NAME_RE.test(n));
  } catch {
    return [];
  }
  const items: { file: string; created_at: number; size: number }[] = [];
  for (const file of names) {
    try {
      const s = await lstat(path.join(dir, file));
      if (s.isFile()) {
        items.push({ file, created_at: Math.floor(s.mtimeMs / 1000), size: s.size });
      }
    } catch {
      // vanished between readdir and lstat
    }
  }
  return items.sort((a, b) => compareNewestFirst(a.file, b.file));
};

const list = async (username: string) => {
  const root = process.env.BACKUP_DIR;
  if (!root) return [];
  return listIn(userDirOf(root, username));
};

const assertPassword = (password: unknown): string => {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw APIError.badRequest(`Password must have at least ${MIN_PASSWORD} characters`);
  }
  return password;
};

const istStamp = (d = new Date()) => {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())}-${p(ist.getUTCHours())}${p(ist.getUTCMinutes())}`;
};

const isExists = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'EEXIST';

const create = async (userId: bigint, username: string, password: string) => {
  assertPassword(password);
  const root = await requireDir();
  const dir = userDirOf(root, username);
  const json = JSON.stringify(await UserService.backupUser(userId));
  const buf = await encryptBackup(json, password);

  await mkdir(dir, { recursive: true, mode: 0o700 });

  // Never overwrite, even under concurrency: the temp file is created exclusively and published
  // with link(), which fails with EEXIST if the final name is taken; either way try the next suffix.
  const base = `myfin-backup-${istStamp()}`;
  let file = '';
  for (let i = 1; i < 1000 && !file; i++) {
    const candidate = i === 1 ? `${base}.myfin` : `${base}-${i}.myfin`;
    const tmp = path.join(dir, `${candidate}.tmp`);
    try {
      await writeFile(tmp, buf, { flag: 'wx', mode: 0o600 });
    } catch (e) {
      if (isExists(e)) continue;
      throw e;
    }
    try {
      await link(tmp, path.join(dir, candidate));
      file = candidate;
    } catch (e) {
      if (!isExists(e)) throw e;
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  }
  if (!file) throw APIError.internalServerError('Could not allocate a backup file name');

  // prune to the newest KEEP (this user's folder only)
  for (const old of (await listIn(dir)).slice(KEEP)) {
    await unlink(path.join(dir, old.file)).catch(() => undefined);
  }
  return { file };
};

const restore = async (userId: bigint, username: string, file: string, password: string) => {
  assertPassword(password);
  const root = await requireDir();
  const dir = userDirOf(root, username);
  const listed = await listIn(dir);
  const entry =
    typeof file === 'string' && !/[\\/]|\.\./.test(file)
      ? listed.find((b) => b.file === file)
      : undefined;
  if (!entry) throw APIError.badRequest('Backup file not found');
  if (entry.size > MAX_FILE_BYTES) throw APIError.badRequest('Backup file is too large');
  const full = path.join(dir, file);
  if ((await lstat(full)).size > MAX_FILE_BYTES)
    throw APIError.badRequest('Backup file is too large');
  const buf = await readFile(full);
  const json = await decryptBackup(buf, password);
  let data: Parameters<typeof UserService.restoreUser>[1];
  try {
    data = JSON.parse(json);
  } catch {
    throw APIError.badRequest('Wrong password or corrupted backup');
  }
  await UserService.restoreUser(userId, data);
};

export default { status, list, create, restore };
