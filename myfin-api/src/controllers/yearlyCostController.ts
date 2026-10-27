import type { NextFunction, Request, Response } from 'express';
import joi from 'joi';
import APIError from '../errorHandling/apiError.js';
import YearlyCostService from '../services/planning/yearlyCostService.js';
import Logger from '../utils/Logger.js';
import CommonsController from './commonsController.js';

const yearlyCostSchema = joi.object({
  name: joi.string().trim().min(1).max(255).required(),
  amount: joi.number().positive().required(),
  due_month: joi.number().integer().min(1).max(12).required(),
  category_id: joi.number().integer().positive().allow(null),
  active: joi.boolean(),
});

const createYearlyCostSchema = yearlyCostSchema.keys({
  link_transaction_id: joi.number().integer().positive().allow(null),
});

const dismissSchema = joi.object({ payee_key: joi.string().min(1).max(255).required() });

const linkSchema = joi.object({
  transaction_id: joi.number().integer().positive().required(),
  yearly_cost_id: joi.number().integer().positive().allow(null).required(),
});

const idParamSchema = joi.object({ id: joi.number().integer().positive().required() }).unknown(true);

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

const costId = async (req: Request) => BigInt((await idParamSchema.validateAsync(req.params)).id);

const getYearlyCosts = handler(async (userId) => ({
  costs: await YearlyCostService.listYearlyCosts(userId),
  status: await YearlyCostService.sinkingStatus(userId),
}));

const createYearlyCost = handler(async (userId, req) =>
  YearlyCostService.createYearlyCost(userId, await createYearlyCostSchema.validateAsync(req.body))
);

const updateYearlyCost = handler(async (userId, req) =>
  YearlyCostService.updateYearlyCost(userId, await costId(req), await yearlyCostSchema.validateAsync(req.body))
);

const deleteYearlyCost = handler(async (userId, req) => {
  await YearlyCostService.deleteYearlyCost(userId, await costId(req));
  return { ok: true };
});

const getSuggestions = handler((userId) => YearlyCostService.suggestions(userId));

const dismissSuggestion = handler(async (userId, req) => {
  const input = await dismissSchema.validateAsync(req.body);
  await YearlyCostService.dismissSuggestion(userId, input.payee_key);
  return { ok: true };
});

const linkTransaction = handler(async (userId, req) => {
  const input = await linkSchema.validateAsync(req.body);
  await YearlyCostService.linkTransaction(
    userId,
    BigInt(input.transaction_id),
    input.yearly_cost_id === null ? null : BigInt(input.yearly_cost_id)
  );
  return { ok: true };
});

const getCandidates = handler(async (userId, req) => YearlyCostService.candidates(userId, await costId(req)));

export default {
  getYearlyCosts,
  createYearlyCost,
  updateYearlyCost,
  deleteYearlyCost,
  getSuggestions,
  dismissSuggestion,
  linkTransaction,
  getCandidates,
};

// Exported for tests
export { yearlyCostSchema, createYearlyCostSchema, dismissSchema, linkSchema };
