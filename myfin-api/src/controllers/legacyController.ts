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
import Logger from '../utils/Logger.js';
import CommonsController from './commonsController.js';

const SECRET_MESSAGE = "Don't store passwords, PINs or OTPs here";
const SECRET_PATTERN = /password|passcode|\bpin\b|\botp\b|cvv/i;

const text = () => joi.string().trim().max(255).allow('');
const phone = () => joi.string().trim().max(255).pattern(/^[0-9 +()\-.,/xX#*]*$/).allow('');

const dataSchemas: Record<LegacyKind, joi.ObjectSchema> = {
  account: joi
    .object({ bank_branch: text(), nominee: text(), documents_location: text() })
    .unknown(false),
  policy: joi
    .object({
      insurer: text(),
      policy_number: text(),
      sum_assured: joi.number().min(0).max(1e13).allow(null),
      nominee: text(),
      claim_helpline: phone(),
      documents_location: text(),
    })
    .unknown(false),
  contact: joi
    .object({ role: text(), name: text(), phone: phone(), email: joi.string().trim().max(255).email().allow('') })
    .unknown(false),
  instruction: joi.object({ text: joi.string().trim().max(5000).allow('') }).unknown(false),
};

const createSchema = joi.object({
  kind: joi.string().valid('account', 'policy', 'contact', 'instruction').required(),
  account_id: joi.alternatives(joi.number().integer().positive(), joi.string().pattern(/^\d+$/)).allow(null),
  data: joi.object().required(),
});
const updateSchema = joi.object({ data: joi.object().required() });
const idSchema = joi.object({ id: joi.string().pattern(/^\d+$/).required() }).unknown(true);

/** Rejects any key or string value that looks like a credential. Runs before the per-kind schema. */
function assertNoSecrets(value: unknown): void {
  if (typeof value === 'string') {
    if (SECRET_PATTERN.test(value)) throw APIError.badRequest(SECRET_MESSAGE);
  } else if (Array.isArray(value)) {
    value.forEach(assertNoSecrets);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_PATTERN.test(k)) throw APIError.badRequest(SECRET_MESSAGE);
      assertNoSecrets(v);
    }
  }
}

async function validateData(kind: LegacyKind, data: unknown) {
  assertNoSecrets(data);
  return dataSchemas[kind].validateAsync(data);
}

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

const entryId = async (req: Request) => BigInt((await idSchema.validateAsync(req.params)).id);

const getAll = handler((userId) => getLegacy(userId));

const create = handler(async (userId, req) => {
  const body = await createSchema.validateAsync(req.body);
  const data = await validateData(body.kind, body.data);
  return createEntry(userId, { kind: body.kind, account_id: body.account_id, data });
});

const update = handler(async (userId, req) => {
  const id = await entryId(req);
  const body = await updateSchema.validateAsync(req.body);
  const kind = await ownedEntryKind(userId, id);
  return updateEntry(userId, id, await validateData(kind, body.data));
});

const remove = handler(async (userId, req) => {
  await deleteEntry(userId, await entryId(req));
  return { ok: true };
});

export default { getAll, create, update, remove };

// Exported for tests
export { assertNoSecrets, dataSchemas };
