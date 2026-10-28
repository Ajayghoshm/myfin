import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ShareInbox from '../../src/share/shareInbox.js';

describe('ShareInbox', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'inbox-'));
    process.env.SHARE_INBOX_DIR = dir;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('saves, lists, reads and removes a file', async () => {
    const item = await ShareInbox.save('stmt.csv', 'a,b');
    expect((await ShareInbox.list()).map((i) => i.id)).toEqual([item.id]);
    expect(await ShareInbox.read(item.id)).toBe('a,b');
    expect(await ShareInbox.remove(item.id)).toBe(true);
    expect(await ShareInbox.list()).toEqual([]);
  });

  it('sanitises names and rejects path traversal ids', async () => {
    const item = await ShareInbox.save('../../etc/pass wd.csv', 'x');
    expect(item.name).toBe('pass_wd.csv');
    expect(await ShareInbox.read('../../etc/passwd')).toBeNull();
    expect(await ShareInbox.remove('../x')).toBe(false);
  });
});
