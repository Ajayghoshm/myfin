import { describe, expect, test } from 'vitest';
import { decryptBackup, encryptBackup } from '../../src/utils/backupCrypto.js';

describe('backupCrypto', () => {
  const json = JSON.stringify({ a: 1, b: 'çãé ✓' });

  test('round-trips', async () => {
    const buf = await encryptBackup(json, 'correct horse');
    expect(buf.subarray(0, 8).toString('utf8')).toBe('MYFINBK1');
    expect(buf[8]).toBe(1);
    expect(await decryptBackup(buf, 'correct horse')).toBe(json);
  });

  test('wrong password throws 400', async () => {
    const buf = await encryptBackup(json, 'correct horse');
    await expect(decryptBackup(buf, 'wrong password')).rejects.toMatchObject({
      code: 400,
      message: 'Wrong password or corrupted backup',
    });
  });

  test('flipped ciphertext byte throws', async () => {
    const buf = Buffer.from(await encryptBackup(json, 'correct horse'));
    buf[buf.length - 1] ^= 0xff;
    await expect(decryptBackup(buf, 'correct horse')).rejects.toMatchObject({ code: 400 });
  });

  test('wrong magic throws', async () => {
    const buf = Buffer.from(await encryptBackup(json, 'correct horse'));
    buf[0] = 0x58;
    await expect(decryptBackup(buf, 'correct horse')).rejects.toMatchObject({ code: 400 });
  });

  test('truncated file throws', async () => {
    await expect(decryptBackup(Buffer.from('MYFINBK1'), 'correct horse')).rejects.toMatchObject({
      code: 400,
    });
  });

  test.each([
    ['salt', 9],
    ['iv', 25],
    ['tag', 37],
    ['version byte', 8],
  ])('tampered %s throws', async (_name, offset) => {
    const buf = Buffer.from(await encryptBackup(json, 'correct horse'));
    buf[offset] ^= 0x01;
    await expect(decryptBackup(buf, 'correct horse')).rejects.toMatchObject({ code: 400 });
  });
});
