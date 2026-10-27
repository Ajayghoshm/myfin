import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import APIError from '../errorHandling/apiError.js';

const MAGIC = Buffer.from('MYFINBK1', 'utf8');
const VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + 1 + SALT_LEN + IV_LEN + TAG_LEN;

const deriveKey = (password: string, salt: Buffer) =>
  scryptSync(password, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

/** Layout: magic(8) | version(1) | salt(16) | iv(12) | tag(16) | ciphertext. */
export const encryptBackup = (json: string, password: string): Buffer => {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv, cipher.getAuthTag(), ciphertext]);
};

export const decryptBackup = (buf: Buffer, password: string): string => {
  const fail = () => APIError.badRequest('Wrong password or corrupted backup');
  if (buf.length < HEADER_LEN || !buf.subarray(0, MAGIC.length).equals(MAGIC)) throw fail();
  if (buf[MAGIC.length] !== VERSION) throw fail();
  const saltStart = MAGIC.length + 1;
  const ivStart = saltStart + SALT_LEN;
  const tagStart = ivStart + IV_LEN;
  const salt = buf.subarray(saltStart, ivStart);
  const iv = buf.subarray(ivStart, tagStart);
  const tag = buf.subarray(tagStart, HEADER_LEN);
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(password, salt), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buf.subarray(HEADER_LEN)), decipher.final()]).toString(
      'utf8'
    );
  } catch {
    throw fail();
  }
};
