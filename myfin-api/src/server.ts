import 'dotenv/config.js';
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
