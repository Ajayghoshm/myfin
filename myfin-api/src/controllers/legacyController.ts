import type { NextFunction, Request, Response } from 'express';
import joi from 'joi';
import APIError from '../errorHandling/apiError.js';
import {
  createEntry,
  deleteEntry,
  getLegacy,
  ownedEntryKind,
  updateEntry,
  type LegacyKind,
} from '../services/legacyService.js';
import { assertNoSecrets, validateLegacyData } from '../services/legacyValidation.js';
import Logger from '../utils/Logger.js';
import CommonsController from './commonsController.js';

const createSchema = joi.object({
  kind: joi.string().valid('account', 'policy', 'contact', 'instruction').required(),
  account_id: joi.alternatives(joi.number().integer().positive(), joi.string().pattern(/^\d{1,19}$/)).allow(null),
  data: joi.object().required(),
});
const updateSchema = joi.object({ data: joi.object().required() });
const idSchema = joi.object({ id: joi.string().pattern(/^\d{1,19}$/).required() }).unknown(true);

const handler =
  (fn: (userId: bigint, req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionData = await CommonsController.checkAuthSessionValidity(req);
      res.json(await fn(sessionData.userId, req));
    } catch (err) {
      Logger.addErrorLog(err);
      next(err || APIError.internalServerError());
    }
  };

const entryId = async (req: Request) => BigInt((await idSchema.validateAsync(req.params)).id);

const getAll = handler((userId) => getLegacy(userId));

const create = handler(async (userId, req) => {
  assertNoSecrets(req.body);
  const body = await createSchema.validateAsync(req.body);
  const data = await validateLegacyData(body.kind, body.data);
  return createEntry(userId, { kind: body.kind, account_id: body.account_id, data });
});

const update = handler(async (userId, req) => {
  const id = await entryId(req);
  assertNoSecrets(req.body);
  const body = await updateSchema.validateAsync(req.body);
  const kind = await ownedEntryKind(userId, id);
  return updateEntry(userId, id, await validateLegacyData(kind, body.data));
});

const remove = handler(async (userId, req) => {
  await deleteEntry(userId, await entryId(req));
  return { ok: true };
});

export default { getAll, create, update, remove };

