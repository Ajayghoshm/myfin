import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SharePairing from '../../src/share/sharePairing.js';

describe('SharePairing', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'pair-'));
    process.env.SHARE_INBOX_DIR = dir;
    process.env.SHARE_PUBLIC_URL = 'https://mac.local:3443/';
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('exchanges a one-time code for a device token that validates, then can be revoked', async () => {
    const { code, url } = SharePairing.createCode();
    expect(url).toBe(`https://mac.local:3443/share/?code=${code}`);
    const token = await SharePairing.redeemCode(code, 'Pixel');
    expect(token).toBeTruthy();
    expect(await SharePairing.isValidToken(token)).toBe(true);
    expect(await SharePairing.redeemCode(code, 'Again')).toBeNull(); // single use

    const [device] = await SharePairing.listDevices();
    expect(device.name).toBe('Pixel');
    expect(await SharePairing.removeDevice(device.id)).toBe(true);
    expect(await SharePairing.isValidToken(token)).toBe(false);
  });

  it('locks out after repeated wrong codes, even for the right code', async () => {
    const { code } = SharePairing.createCode();
    for (let i = 0; i < 5; i++) expect(await SharePairing.redeemCode('000x00', 'x')).toBeNull();
    expect(await SharePairing.redeemCode(code, 'x')).toBeNull();
  });
});
