import type { NextFunction, Request, Response } from 'express';
import joi from 'joi';
import APIError from '../errorHandling/apiError.js';
import DebtService from '../services/debts/debtService.js';
import Logger from '../utils/Logger.js';
import CommonsController from './commonsController.js';

const epoch = () => joi.number().integer().min(0);

const createPeopleDebtSchema = joi
  .object({
    kind: joi.string().valid('lent', 'borrowed').required(),
    name: joi.string().trim().min(1).max(255).required(),
    amount: joi.number().positive(),
    date: epoch(),
    due_date: epoch().allow(null),
    note: joi.string().trim().max(2000).allow('', null),
    transaction_id: joi.number().integer().positive().allow(null),
  })
  .when(joi.object({ transaction_id: joi.number().required() }).unknown(), {
    otherwise: joi.object({ amount: joi.required(), date: joi.required() }),
  });

const updateDebtSchema = joi.object({
  name: joi.string().trim().min(1).max(255).required(),
  amount: joi.number().positive(),
  date: epoch(),
  due_date: epoch().allow(null),
  note: joi.string().trim().max(2000).allow('', null),
});

const repaymentSchema = joi
  .object({
    amount: joi.number().positive(),
    date: epoch(),
    transaction_id: joi.number().integer().positive().allow(null),
  })
  .when(joi.object({ transaction_id: joi.number().required() }).unknown(), {
    otherwise: joi.object({ amount: joi.required(), date: joi.required() }),
  });

const idParamSchema = joi
  .object({
    id: joi.number().integer().positive().required(),
    paymentId: joi.number().integer().positive(),
  })
  .unknown(true);

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

const params = async (req: Request) => {
  const p = await idParamSchema.validateAsync(req.params);
  return { id: BigInt(p.id), paymentId: p.paymentId == null ? null : BigInt(p.paymentId) };
};

const getDebts = handler((userId) => DebtService.listDebts(userId));

const createDebt = handler(async (userId, req) =>
  DebtService.createPeopleDebt(userId, await createPeopleDebtSchema.validateAsync(req.body))
);

const updateDebt = handler(async (userId, req) =>
  DebtService.updateDebt(userId, (await params(req)).id, await updateDebtSchema.validateAsync(req.body))
);

const deleteDebt = handler(async (userId, req) => {
  await DebtService.deleteDebt(userId, (await params(req)).id);
  return { ok: true };
});

const addRepayment = handler(async (userId, req) =>
  DebtService.addRepayment(userId, (await params(req)).id, await repaymentSchema.validateAsync(req.body))
);

const getRepaymentSuggestions = handler(async (userId, req) =>
  DebtService.repaymentSuggestions(userId, (await params(req)).id)
);

const deleteRepayment = handler(async (userId, req) => {
  const { id, paymentId } = await params(req);
  if (paymentId == null) throw APIError.badRequest('paymentId is required.');
  return DebtService.deleteRepayment(userId, id, paymentId);
});

export default {
  getDebts,
  createDebt,
  updateDebt,
  deleteDebt,
  addRepayment,
  getRepaymentSuggestions,
  deleteRepayment,
};

// Exported for tests
export { createPeopleDebtSchema, updateDebtSchema, repaymentSchema };
