import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import UserController from '../../src/controllers/userController.js';
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
    const { file } = await FolderBackupService.create(uid, 'demo', 'password123');
    expect(file).toMatch(/^myfin-backup-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.myfin$/);
    const list = await FolderBackupService.list('demo');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ file });
    expect(list[0].size).toBeGreaterThan(0);

    await mkAccount('After');
    expect(await accountNames()).toEqual(['After', 'Before']);
    await FolderBackupService.restore(uid, 'demo', file, 'password123');
    expect(await accountNames()).toEqual(['Before']);
  });

  test('same-minute creates never overwrite', async () => {
    const a = await FolderBackupService.create(uid, 'demo', 'password123');
    const b = await FolderBackupService.create(uid, 'demo', 'password123');
    const c = await FolderBackupService.create(uid, 'demo', 'password123');
    expect(new Set([a.file, b.file, c.file]).size).toBe(3);
    expect(await readdir(path.join(dir, 'demo'))).toHaveLength(3);
  });

  test('wrong password on restore: 400 and data unchanged', async () => {
    await mkAccount('Before');
    const { file } = await FolderBackupService.create(uid, 'demo', 'password123');
    await mkAccount('After');
    await expect(
      FolderBackupService.restore(uid, 'demo', file, 'not-the-password')
    ).rejects.toMatchObject({
      code: 400,
    });
    expect(await accountNames()).toEqual(['After', 'Before']);
  });

  test('keeps only the newest 30 and ignores temp/foreign files', async () => {
    await mkdir(path.join(dir, 'demo'));
    await writeFile(path.join(dir, 'demo', 'notes.txt'), 'x');
    await writeFile(path.join(dir, 'demo', 'myfin-backup-2020-01-01-0000.myfin.tmp'), 'x');
    for (let i = 0; i < 31; i++) await FolderBackupService.create(uid, 'demo', 'password123');
    const files = await readdir(path.join(dir, 'demo'));
    expect(files.filter((f) => /^myfin-backup-.*\.myfin$/.test(f))).toHaveLength(30);
    expect(files).toContain('notes.txt');
    expect(files).toContain('myfin-backup-2020-01-01-0000.myfin.tmp');
    expect(await FolderBackupService.list('demo')).toHaveLength(30);
  }, 120_000);

  test('path traversal / unlisted file names are rejected with 400', async () => {
    await FolderBackupService.create(uid, 'demo', 'password123');
    for (const bad of [
      '../x.myfin',
      'a/b.myfin',
      'a\\b.myfin',
      '..',
      'myfin-backup-1999-01-01-0000.myfin',
    ]) {
      await expect(
        FolderBackupService.restore(uid, 'demo', bad, 'password123')
      ).rejects.toMatchObject({
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
    expect(await FolderBackupService.list('demo')).toEqual([]);
  });

  test('create refuses a short password and an unavailable dir', async () => {
    await expect(FolderBackupService.create(uid, 'demo', 'short')).rejects.toMatchObject({
      code: 400,
    });
    Reflect.deleteProperty(process.env, 'BACKUP_DIR');
    await expect(FolderBackupService.create(uid, 'demo', 'password123')).rejects.toMatchObject({
      code: 400,
    });
  });

  test("users cannot see, prune or restore each other's backups", async () => {
    await mkAccount('A-data');
    const a = await FolderBackupService.create(uid, 'demo', 'password123');
    const other = await UserService.createUser({
      username: 'other',
      password: '123',
      email: 'o@afaneca.com',
    });
    expect(await FolderBackupService.list('other')).toEqual([]);
    await expect(
      FolderBackupService.restore(other.user_id, 'other', a.file, 'password123')
    ).rejects.toMatchObject({ code: 400 });
    for (let i = 0; i < 31; i++)
      await FolderBackupService.create(other.user_id, 'other', 'password123');
    expect((await FolderBackupService.list('other')).length).toBe(30);
    expect((await FolderBackupService.list('demo')).map((b) => b.file)).toEqual([a.file]);
  }, 120_000);

  test('unsafe usernames are rejected', async () => {
    for (const bad of ['../evil', 'a/b', '', '..', 'sp ace']) {
      await expect(FolderBackupService.create(uid, bad, 'password123')).rejects.toMatchObject({
        code: 400,
      });
    }
  });

  test('statusFor reports an unusable username as unavailable instead of throwing', async () => {
    expect(await FolderBackupService.statusFor('demo')).toEqual({ available: true });
    expect(await FolderBackupService.statusFor('sp ace')).toMatchObject({
      available: false,
      reason: expect.any(String),
    });
  });

  test('orders by name timestamp and numeric suffix; skips symlinks', async () => {
    const d = path.join(dir, 'demo');
    await mkdir(d);
    for (const n of [
      'myfin-backup-2026-01-01-1000.myfin',
      'myfin-backup-2026-01-01-1000-2.myfin',
      'myfin-backup-2026-01-01-1000-10.myfin',
      'myfin-backup-2025-12-31-2359.myfin',
    ])
      await writeFile(path.join(d, n), 'x');
    await symlink(
      path.join(d, 'myfin-backup-2025-12-31-2359.myfin'),
      path.join(d, 'myfin-backup-2030-01-01-0000.myfin')
    );
    expect((await FolderBackupService.list('demo')).map((b) => b.file)).toEqual([
      'myfin-backup-2026-01-01-1000-10.myfin',
      'myfin-backup-2026-01-01-1000-2.myfin',
      'myfin-backup-2026-01-01-1000.myfin',
      'myfin-backup-2025-12-31-2359.myfin',
    ]);
  });

  test('concurrent creates never overwrite', async () => {
    const res = await Promise.all(
      Array.from({ length: 4 }, () => FolderBackupService.create(uid, 'demo', 'password123'))
    );
    expect(new Set(res.map((r) => r.file)).size).toBe(4);
    expect(await readdir(path.join(dir, 'demo'))).toHaveLength(4);
  }, 60_000);

  test('a failing validation does not log the password', async () => {
    process.env.BYPASS_SESSION_CHECK = 'true';
    process.env.LOGGING = 'true';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const req = {
      get: (h: string) => (h === 'authusername' ? 'demo' : undefined),
      body: { password: 'sh0rt-secret'.slice(0, 7), extra: 'TOP-SECRET-VALUE' },
    };
    const next = vi.fn();
    try {
      await UserController.createFolderBackup(req as never, { json: vi.fn() } as never, next);
      await UserController.changeUserPassword(
        { ...req, body: { current_password: 'TOP-SECRET-VALUE' } } as never,
        { json: vi.fn() } as never,
        next
      );
      expect(next).toHaveBeenCalledTimes(2);
      const logged = spy.mock.calls.map((c) => JSON.stringify(c)).join('\n');
      expect(logged).not.toContain('sh0rt-s');
      expect(logged).not.toContain('TOP-SECRET-VALUE');
      expect(logged).toContain('ValidationError');
    } finally {
      spy.mockRestore();
      process.env.LOGGING = 'false';
    }
  });
});
