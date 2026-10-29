import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const certDir = () => path.resolve(process.env.SHARE_CERT_DIR || './certs');
const certFile = () => process.env.SHARE_TLS_CERT || path.join(certDir(), 'share.pem');
const keyFile = () => process.env.SHARE_TLS_KEY || path.join(certDir(), 'share-key.pem');
const namesFile = () => path.join(certDir(), 'share.names');

/** HTTPS is on when asked for explicitly or when cert paths are given. */
const enabled = () =>
  process.env.SHARE_HTTPS === 'true' || !!(process.env.SHARE_TLS_CERT && process.env.SHARE_TLS_KEY);

/** Explicit cert paths are the user's own; only the auto-managed certificate gets regenerated. */
const autoManaged = () => !(process.env.SHARE_TLS_CERT && process.env.SHARE_TLS_KEY);

const lanIps = (): string[] =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);

const hostName = () => {
  const h = os.hostname();
  return h.includes('.') ? h : `${h}.local`;
};

const names = () => [...new Set([hostName(), 'localhost', '127.0.0.1', ...lanIps()])].sort();

const primaryIp = (): string | undefined => {
  const ips = lanIps();
  return ips.find((ip) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(ip)) ?? ips[0];
};

let server: https.Server | null = null;
let lastNames = '';

/** Regenerates the auto-managed certificate if the laptop's names/IPs changed. Returns true if regenerated. */
const ensureCert = async (): Promise<boolean> => {
  if (!autoManaged()) return false;
  const wanted = names().join('\n');
  let current = '';
  try {
    current = await readFile(namesFile(), 'utf8');
  } catch {}
  if (current === wanted && existsSync(certFile()) && existsSync(keyFile())) return false;
  await mkdir(certDir(), { recursive: true });
  await run('mkcert', ['-cert-file', certFile(), '-key-file', keyFile(), ...names()]);
  await writeFile(namesFile(), wanted, 'utf8');
  return true;
};

const credentials = () => ({ cert: readFileSync(certFile()), key: readFileSync(keyFile()) });

const register = (s: https.Server) => {
  server = s;
  lastNames = names().join('\n');
};

/** Picks up a changed IP without restarting the API. Never throws: failures keep the old certificate. */
const refresh = async () => {
  if (!server || names().join('\n') === lastNames) return;
  try {
    if (await ensureCert()) server.setSecureContext(credentials());
    lastNames = names().join('\n');
  } catch (err) {
    console.warn('Could not refresh share certificate (is mkcert installed?)', err);
  }
};

export default { enabled, ensureCert, credentials, register, refresh, primaryIp, hostName };
