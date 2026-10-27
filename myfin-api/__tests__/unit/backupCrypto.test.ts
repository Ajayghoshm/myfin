import { describe, expect, test } from 'vitest';
import { decryptBackup, encryptBackup } from '../../src/utils/backupCrypto.js';

describe('backupCrypto', () => {
  const json = JSON.stringify({ a: 1, b: 'çãé ✓' });

  test('round-trips', () => {
    const buf = encryptBackup(json, 'correct horse');
    expect(buf.subarray(0, 8).toString('utf8')).toBe('MYFINBK1');
    expect(buf[8]).toBe(1);
    expect(decryptBackup(buf, 'correct horse')).toBe(json);
  });

  test('wrong password throws 400', () => {
    const buf = encryptBackup(json, 'correct horse');
    expect(() => decryptBackup(buf, 'wrong password')).toThrow(
      expect.objectContaining({ code: 400, message: 'Wrong password or corrupted backup' })
    );
  });

  test('flipped ciphertext byte throws', () => {
    const buf = Buffer.from(encryptBackup(json, 'correct horse'));
    buf[buf.length - 1] ^= 0xff;
    expect(() => decryptBackup(buf, 'correct horse')).toThrow(
      expect.objectContaining({ code: 400 })
    );
  });

  test('wrong magic throws', () => {
    const buf = Buffer.from(encryptBackup(json, 'correct horse'));
    buf[0] = 0x58;
    expect(() => decryptBackup(buf, 'correct horse')).toThrow(
      expect.objectContaining({ code: 400 })
    );
  });

  test('truncated file throws', () => {
    expect(() => decryptBackup(Buffer.from('MYFINBK1'), 'correct horse')).toThrow(
      expect.objectContaining({ code: 400 })
    );
  });
});
