import type { NextFunction, Request, Response } from 'express';
import joi from 'joi';
import APIError from '../errorHandling/apiError.js';
import PlannedTransactionService from '../services/planning/plannedTransactionService.js';
import Logger from '../utils/Logger.js';
import CommonsController from './commonsController.js';

const idParamSchema = joi.object({ id: joi.number().integer().positive().required() }).unknown(true);

const matchesQuerySchema = joi
  .object({
    transaction_ids: joi
      .string()
      .pattern(/^\d+(,\d+)*$/)
      .max(4000)
      .required(),
  })
  .unknown(true);

const matchBodySchema = joi.object({ transaction_id: joi.number().integer().positive().required() });

const handler =
  (fn: (userId: bigint, req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionData = await CommonsController.checkAuthSessionValidity(req);
      res.json(await fn(sessionData.userId, req));
    } catch (err) {
      Logger.addLog(err);
      next(err || APIError.internalServerError());
    }
  };

const plannedId = async (req: Request) => BigInt((await idParamSchema.validateAsync(req.params)).id);

const getPlanned = handler((userId) => PlannedTransactionService.listPlanned(userId));

const markDone = handler(async (userId, req) => ({
  transaction_id: (await PlannedTransactionService.markDone(userId, await plannedId(req))).toString(),
}));

const skipPlanned = handler(async (userId, req) => {
  await PlannedTransactionService.skip(userId, await plannedId(req));
  return { ok: true };
});

const getMatches = handler(async (userId, req) => {
  const query = await matchesQuerySchema.validateAsync(req.query);
  const ids = (query.transaction_ids as string).split(',').map((s) => BigInt(s));
  return PlannedTransactionService.findMatches(userId, ids);
});

const getCandidates = handler(async (userId, req) =>
  PlannedTransactionService.candidatesFor(userId, await plannedId(req))
);

const confirmMatch = handler(async (userId, req) => {
  const body = await matchBodySchema.validateAsync(req.body);
  await PlannedTransactionService.confirmMatch(userId, await plannedId(req), BigInt(body.transaction_id));
  return { ok: true };
});

export default { getPlanned, markDone, skipPlanned, getMatches, getCandidates, confirmMatch };

// Exported for tests
export { matchesQuerySchema, matchBodySchema };
