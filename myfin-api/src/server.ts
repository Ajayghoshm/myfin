import 'dotenv/config.js';
import https from 'node:https';
import app from './app.js';
import ShareTls from './share/shareTls.js';
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
if (ShareTls.enabled()) {
  const HTTPS_PORT = process.env.SHARE_HTTPS_PORT || 3443;
  try {
    await ShareTls.ensureCert();
    const httpsServer = https.createServer(ShareTls.credentials(), app);
    ShareTls.register(httpsServer);
    httpsServer.listen(HTTPS_PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`MyFin share (HTTPS) listening on port ${HTTPS_PORT}`);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Phone sharing disabled: could not set up the HTTPS certificate (is mkcert installed?)', err);
  }
}
