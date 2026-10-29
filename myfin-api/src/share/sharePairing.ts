import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ShareTls from './shareTls.js';

export type Device = { id: string; name: string; token_hash: string; created_at: number };

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 60 * 1000;

let activeCode: { code: string; expiresAt: number } | null = null;
let failures = 0;
let lockedUntil = 0;

const devicesFile = () =>
  path.resolve(process.env.SHARE_INBOX_DIR || './share-inbox', '.devices.json');

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

const loadDevices = async (): Promise<Device[]> => {
  try {
    return JSON.parse(await readFile(devicesFile(), 'utf8'));
  } catch {
    return [];
  }
};

const saveDevices = async (devices: Device[]) => {
  await mkdir(path.dirname(devicesFile()), { recursive: true });
  await writeFile(devicesFile(), JSON.stringify(devices, null, 2), 'utf8');
};

/** Address the phone should use; SHARE_PUBLIC_URL wins, else the Mac's stable .local name. */
const publicUrl = () => {
  if (process.env.SHARE_PUBLIC_URL) return process.env.SHARE_PUBLIC_URL.replace(/\/$/, '');
  return `https://${ShareTls.hostName()}:${process.env.SHARE_HTTPS_PORT || 3443}`;
};

const ipUrl = () => {
  const ip = ShareTls.primaryIp();
  return ip ? `https://${ip}:${process.env.SHARE_HTTPS_PORT || 3443}` : null;
};

const createCode = () => {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  activeCode = { code, expiresAt: Date.now() + CODE_TTL_MS };
  failures = 0;
  const ip = ipUrl();
  return {
    code,
    expires_at: activeCode.expiresAt,
    url: `${publicUrl()}/share/?code=${code}`,
    ip_url: ip ? `${ip}/share/?code=${code}` : null,
  };
};

/** Exchanges a valid one-time code for a per-phone token. Returns null if the code is wrong/expired/locked. */
const redeemCode = async (code: unknown, deviceName: string): Promise<string | null> => {
  const now = Date.now();
  if (now < lockedUntil) return null;
  const valid =
    activeCode !== null &&
    now < activeCode.expiresAt &&
    typeof code === 'string' &&
    code.length === activeCode.code.length &&
    timingSafeEqual(Buffer.from(code), Buffer.from(activeCode.code));
  if (!valid) {
    if (++failures >= MAX_FAILURES) {
      activeCode = null;
      lockedUntil = now + LOCKOUT_MS;
      failures = 0;
    }
    return null;
  }
  activeCode = null;
  const token = randomBytes(32).toString('hex');
  const devices = await loadDevices();
  devices.push({
    id: randomBytes(4).toString('hex'),
    name: deviceName.slice(0, 40) || 'Phone',
    token_hash: hash(token),
    created_at: now,
  });
  await saveDevices(devices);
  return token;
};

const isValidToken = async (token: unknown) => {
  if (typeof token !== 'string' || !token) return false;
  const h = hash(token);
  return (await loadDevices()).some((d) => d.token_hash === h);
};

const listDevices = async () =>
  (await loadDevices()).map(({ id, name, created_at }) => ({ id, name, created_at }));

const removeDevice = async (id: string) => {
  const devices = await loadDevices();
  const left = devices.filter((d) => d.id !== id);
  await saveDevices(left);
  return left.length !== devices.length;
};

export default { createCode, redeemCode, isValidToken, listDevices, removeDevice, publicUrl };
