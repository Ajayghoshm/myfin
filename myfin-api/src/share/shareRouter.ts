import express from 'express';
import ShareInbox from './shareInbox.js';
import SharePairing from './sharePairing.js';

/**
 * Phone-facing side of the share inbox: the installable PWA (static) and a
 * token-protected upload endpoint. Listing/reading/deleting inbox files for
 * the web app goes through the normal session-authenticated transaction routes.
 */
const shareRouter = express.Router();

shareRouter.post('/pair', express.json(), async (req, res, next) => {
  try {
    const token = await SharePairing.redeemCode(req.body?.code, String(req.body?.name ?? ''));
    if (!token) {
      res.status(401).json({ error: 'Invalid or expired code' });
      return;
    }
    res.status(201).json({ token });
  } catch (err) {
    next(err);
  }
});

shareRouter.post(
  '/upload',
  express.text({ type: '*/*', limit: '5mb' }),
  async (req, res, next) => {
    try {
      if (!(await SharePairing.isValidToken(req.header('x-share-token')))) {
        res.status(401).json({ error: 'Phone not paired' });
        return;
      }
      if (typeof req.body !== 'string' || req.body.length === 0) {
        res.status(400).json({ error: 'Empty file' });
        return;
      }
      const name = String(req.query.name ?? 'statement.csv');
      res.status(201).json(await ShareInbox.save(name, req.body));
    } catch (err) {
      next(err);
    }
  }
);

shareRouter.use(
  express.static(new URL('../../share-pwa', import.meta.url).pathname, {
    setHeaders: (res, file) => {
      if (file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

export default shareRouter;
