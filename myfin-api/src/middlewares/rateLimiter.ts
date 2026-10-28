import type { Application, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import Logger from '../utils/Logger.js';

export const rateLimiter = (app?: Application): RequestHandler => {
  // If an app instance is provided, configure trust proxy based on env var.
  const trustProxy = process.env.TRUST_PROXY || 'false';
  if (app) {
    if (trustProxy !== 'false') {
      if (trustProxy === 'true') {
        app.set('trust proxy', true);
      } else if (!Number.isNaN(Number(trustProxy))) {
        app.set('trust proxy', Number(trustProxy));
      } else {
        app.set('trust proxy', trustProxy);
      }
      Logger.addLog(`Trust proxy enabled: ${trustProxy}`);
    } else {
      Logger.addLog('Trust proxy disabled (direct access mode)');
    }
  }

  // The dashboard and insights pages each load many cards, one request apiece.
  const parsedLimit = Number(process.env.RATE_LIMIT_PER_MINUTE);
  const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 600;

  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    message: `You have exceeded your ${limit} requests per minute limit.`,
    legacyHeaders: true,
  });
};
