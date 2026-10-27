import type { NextFunction, Request, Response } from 'express';
import joi from 'joi';
import APIError from '../errorHandling/apiError.js';
import LoanService from '../services/debts/loanService.js';
import Logger from '../utils/Logger.js';
import CommonsController from './commonsController.js';

const epoch = () => joi.number().integer().min(0);

const createLoanSchema = joi.object({
  lender: joi.string().trim().min(1).max(255).required(),
  principal: joi.number().positive().required(),
  rate: joi.number().min(0).max(100).required(),
  tenure_months: joi.number().integer().min(1).max(600).required(),
  emi: joi.number().positive().allow(null),
  emi_day: joi.number().integer().min(1).max(31).required(),
  account_id: joi.number().integer().positive().required(),
  start_date: epoch().required(),
  disbursement_transaction_id: joi.number().integer().positive().allow(null),
});

const matchSchema = joi.object({
  transaction_id: joi.number().integer().positive().required(),
});

const markPaidSchema = joi.object({
  date: epoch().allow(null),
});

const prepaymentQuerySchema = joi
  .object({
    amount: joi.number().positive().required(),
    after_installment: joi.number().integer().min(0).required(),
  })
  .unknown(true);

const loanParamsSchema = joi
  .object({
    id: joi.number().integer().positive().required(),
    n: joi.number().integer().min(1),
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
  const p = await loanParamsSchema.validateAsync(req.params);
  return { id: BigInt(p.id), n: p.n == null ? null : Number(p.n) };
};

const installmentParams = async (req: Request) => {
  const p = await params(req);
  if (p.n == null) throw APIError.badRequest('An installment number is required.');
  return { id: p.id, n: p.n };
};

const getLoans = handler((userId) => LoanService.listLoans(userId));

const createLoan = handler(async (userId, req) =>
  LoanService.createLoan(userId, await createLoanSchema.validateAsync(req.body))
);

const getLoan = handler(async (userId, req) => LoanService.getLoan(userId, (await params(req)).id));

const matchInstallment = handler(async (userId, req) => {
  const { id, n } = await installmentParams(req);
  const body = await matchSchema.validateAsync(req.body);
  return LoanService.matchInstallment(userId, id, n, body.transaction_id);
});

const markInstallmentPaid = handler(async (userId, req) => {
  const { id, n } = await installmentParams(req);
  const body = await markPaidSchema.validateAsync(req.body ?? {});
  return LoanService.markInstallmentPaid(userId, id, n, body);
});

const markPastInstallmentsPaid = handler(async (userId, req) =>
  LoanService.markPastInstallmentsPaid(userId, (await params(req)).id)
);

const unpayInstallment = handler(async (userId, req) => {
  const { id, n } = await installmentParams(req);
  return LoanService.unpayInstallment(userId, id, n);
});

const getMatchSuggestions = handler(async (userId, req) =>
  LoanService.matchSuggestions(userId, (await params(req)).id)
);

const getPrepayment = handler(async (userId, req) => {
  const { id } = await params(req);
  const q = await prepaymentQuerySchema.validateAsync(req.query);
  return LoanService.prepayment(userId, id, Number(q.amount), Number(q.after_installment));
});

export default {
  getLoans,
  createLoan,
  getLoan,
  matchInstallment,
  markInstallmentPaid,
  markPastInstallmentsPaid,
  unpayInstallment,
  getMatchSuggestions,
  getPrepayment,
};

// Exported for tests
export { createLoanSchema, matchSchema, markPaidSchema, prepaymentQuerySchema };
