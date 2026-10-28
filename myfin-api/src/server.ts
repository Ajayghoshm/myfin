import 'dotenv/config.js';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import app from './app.js';
import DemoAccountScheduler from './utils/demoAccountScheduler.js';

// Default to UTC only when the deployment did not choose a time zone (e.g. TZ=Asia/Kolkata)
process.env.TZ ??= 'Etc/UTC';

const PORT = process.env.PORT || 3001;
DemoAccountScheduler.start();
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`MyFin server listening on port ${PORT}`);
});

// Optional HTTPS listener so the phone can install the share PWA (Android requires HTTPS)
if (process.env.SHARE_TLS_CERT && process.env.SHARE_TLS_KEY) {
  const HTTPS_PORT = process.env.SHARE_HTTPS_PORT || 3443;
  https
    .createServer(
      {
        cert: readFileSync(process.env.SHARE_TLS_CERT),
        key: readFileSync(process.env.SHARE_TLS_KEY),
      },
      app
    )
    .listen(HTTPS_PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`MyFin share (HTTPS) listening on port ${HTTPS_PORT}`);
    });
}
