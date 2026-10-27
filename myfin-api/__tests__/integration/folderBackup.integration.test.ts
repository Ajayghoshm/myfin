import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import AccountService from '../../src/services/accountService.js';
import FolderBackupService from '../../src/services/folderBackupService.js';
import UserService from '../../src/services/userService.js';

describe('Folder backups', () => {
  let uid: bigint;
  let dir: string;
  const original = process.env.BACKUP_DIR;

  const mkAccount = (name: string) =>
    AccountService.createAccount(
      {
        name,
        type: MYFIN.ACCOUNT_TYPES.CHECKING,
        description: '',
        status: MYFIN.ACCOUNT_STATUS.ACTIVE,
        exclude_from_budgets: false,
        current_balance: 0,
        users_user_id: uid,
      },
      uid
    );
  const accountNames = async () =>
    (await prisma.accounts.findMany({ where: { users_user_id: uid } })).map((a) => a.name).sort();

  beforeEach(async () => {
    const user = await UserService.createUser({
      username: 'demo',
      password: '123',
      email: 'demo@afaneca.com',
    });
    uid = user.user_id;
    dir = await mkdtemp(path.join(tmpdir(), 'myfin-bk-'));
    process.env.BACKUP_DIR = dir;
  });

  afterEach(async () => {
    if (original === undefined) Reflect.deleteProperty(process.env, 'BACKUP_DIR');
    else process.env.BACKUP_DIR = original;
    await rm(dir, { recursive: true, force: true });
  });

  test('create, list, restore round-trip', async () => {
    await mkAccount('Before');
    const { file } = await FolderBackupService.create(uid, 'password123');
    expect(file).toMatch(/^myfin-backup-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.myfin$/);
    const list = await FolderBackupService.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ file });
    expect(list[0].size).toBeGreaterThan(0);

    await mkAccount('After');
    expect(await accountNames()).toEqual(['After', 'Before']);
    await FolderBackupService.restore(uid, file, 'password123');
    expect(await accountNames()).toEqual(['Before']);
  });

  test('same-minute creates never overwrite', async () => {
    const a = await FolderBackupService.create(uid, 'password123');
    const b = await FolderBackupService.create(uid, 'password123');
    const c = await FolderBackupService.create(uid, 'password123');
    expect(new Set([a.file, b.file, c.file]).size).toBe(3);
    expect(await readdir(dir)).toHaveLength(3);
  });

  test('wrong password on restore: 400 and data unchanged', async () => {
    await mkAccount('Before');
    const { file } = await FolderBackupService.create(uid, 'password123');
    await mkAccount('After');
    await expect(FolderBackupService.restore(uid, file, 'not-the-password')).rejects.toMatchObject({
      code: 400,
    });
    expect(await accountNames()).toEqual(['After', 'Before']);
  });

  test('keeps only the newest 30 and ignores temp/foreign files', async () => {
    await writeFile(path.join(dir, 'notes.txt'), 'x');
    await writeFile(path.join(dir, 'myfin-backup-2020-01-01-0000.myfin.tmp'), 'x');
    for (let i = 0; i < 31; i++) await FolderBackupService.create(uid, 'password123');
    const files = await readdir(dir);
    expect(files.filter((f) => /^myfin-backup-.*\.myfin$/.test(f))).toHaveLength(30);
    expect(files).toContain('notes.txt');
    expect(files).toContain('myfin-backup-2020-01-01-0000.myfin.tmp');
    expect(await FolderBackupService.list()).toHaveLength(30);
  }, 120_000);

  test('path traversal / unlisted file names are rejected with 400', async () => {
    await FolderBackupService.create(uid, 'password123');
    for (const bad of [
      '../x.myfin',
      'a/b.myfin',
      'a\\b.myfin',
      '..',
      'myfin-backup-1999-01-01-0000.myfin',
    ]) {
      await expect(FolderBackupService.restore(uid, bad, 'password123')).rejects.toMatchObject({
        code: 400,
      });
    }
  });

  test('status reflects BACKUP_DIR', async () => {
    expect(await FolderBackupService.status()).toEqual({ available: true });
    Reflect.deleteProperty(process.env, 'BACKUP_DIR');
    expect(await FolderBackupService.status()).toMatchObject({ available: false });
    process.env.BACKUP_DIR = path.join(dir, 'missing');
    expect(await FolderBackupService.status()).toMatchObject({ available: false });
    expect(await FolderBackupService.list()).toEqual([]);
  });

  test('create refuses a short password and an unavailable dir', async () => {
    await expect(FolderBackupService.create(uid, 'short')).rejects.toMatchObject({ code: 400 });
    Reflect.deleteProperty(process.env, 'BACKUP_DIR');
    await expect(FolderBackupService.create(uid, 'password123')).rejects.toMatchObject({
      code: 400,
    });
  });
});
