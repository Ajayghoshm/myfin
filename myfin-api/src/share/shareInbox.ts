import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type InboxItem = { id: string; name: string; size: number; received_at: number };

const ID_PATTERN = /^\d{13}-[0-9a-f]{8}-[A-Za-z0-9._-]{1,80}$/;

const inboxDir = () => path.resolve(process.env.SHARE_INBOX_DIR || './share-inbox');

const safeName = (name: string) =>
  path
    .basename(name || 'statement.csv')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(-80) || 'statement.csv';

const isValidId = (id: string) => ID_PATTERN.test(id);

const save = async (originalName: string, content: string): Promise<InboxItem> => {
  const dir = inboxDir();
  await mkdir(dir, { recursive: true });
  const received_at = Date.now();
  const name = safeName(originalName);
  const id = `${received_at}-${randomBytes(4).toString('hex')}-${name}`;
  await writeFile(path.join(dir, id), content, 'utf8');
  return { id, name, size: Buffer.byteLength(content), received_at };
};

const list = async (): Promise<InboxItem[]> => {
  const dir = inboxDir();
  let ids: string[];
  try {
    ids = await readdir(dir);
  } catch {
    return [];
  }
  const items = await Promise.all(
    ids.filter(isValidId).map(async (id) => {
      const { size } = await stat(path.join(dir, id));
      return {
        id,
        name: id.split('-').slice(2).join('-'),
        size,
        received_at: Number(id.slice(0, 13)),
      };
    })
  );
  return items.sort((a, b) => b.received_at - a.received_at);
};

const read = async (id: string): Promise<string | null> => {
  if (!isValidId(id)) return null;
  try {
    return await readFile(path.join(inboxDir(), id), 'utf8');
  } catch {
    return null;
  }
};

const remove = async (id: string): Promise<boolean> => {
  if (!isValidId(id)) return false;
  try {
    await rm(path.join(inboxDir(), id));
    return true;
  } catch {
    return false;
  }
};

export default { save, list, read, remove, isValidId };
