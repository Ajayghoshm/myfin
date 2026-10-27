import {
  constants,
  access,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import APIError from '../errorHandling/apiError.js';
import { decryptBackup, encryptBackup } from '../utils/backupCrypto.js';
import UserService from './userService.js';

const KEEP = 30;
const NAME_RE = /^myfin-backup-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.myfin$/;
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

const list = async () => {
  const dir = process.env.BACKUP_DIR;
  if (!dir) return [];
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => NAME_RE.test(n));
  } catch {
    return [];
  }
  const items = [];
  for (const file of names) {
    try {
      const s = await stat(path.join(dir, file));
      if (s.isFile()) {
        items.push({ file, created_at: Math.floor(s.mtimeMs / 1000), size: s.size });
      }
    } catch {
      // vanished between readdir and stat
    }
  }
  // newest first; names embed the timestamp, so they break mtime ties
  return items.sort((a, b) => b.created_at - a.created_at || (a.file < b.file ? 1 : -1));
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

const create = async (userId: bigint, password: string) => {
  assertPassword(password);
  const dir = await requireDir();
  const json = JSON.stringify(await UserService.backupUser(userId));
  const buf = encryptBackup(json, password);

  const base = `myfin-backup-${istStamp()}`;
  const taken = new Set(await readdir(dir));
  let file = `${base}.myfin`;
  for (let i = 2; taken.has(file); i++) file = `${base}-${i}.myfin`;

  const tmp = path.join(dir, `${file}.tmp`);
  await writeFile(tmp, buf, { flag: 'wx' });
  await rename(tmp, path.join(dir, file));

  // prune to the newest KEEP
  const all = await list();
  for (const old of all.slice(KEEP)) {
    await unlink(path.join(dir, old.file)).catch(() => undefined);
  }
  return { file };
};

const restore = async (userId: bigint, file: string, password: string) => {
  assertPassword(password);
  const dir = await requireDir();
  if (
    typeof file !== 'string' ||
    file.includes('/') ||
    file.includes('\\') ||
    file.includes('..') ||
    !(await list()).some((b) => b.file === file)
  ) {
    throw APIError.badRequest('Backup file not found');
  }
  const buf = await readFile(path.join(dir, file));
  const json = decryptBackup(buf, password);
  let data: Parameters<typeof UserService.restoreUser>[1];
  try {
    data = JSON.parse(json);
  } catch {
    throw APIError.badRequest('Wrong password or corrupted backup');
  }
  await UserService.restoreUser(userId, data);
};

export default { status, list, create, restore };
