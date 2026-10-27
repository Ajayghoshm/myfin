import type { NextFunction, Request, Response } from 'express';
import joi from 'joi';
import APIError from '../errorHandling/apiError.js';
import SalaryPlanService from '../services/planning/salaryPlanService.js';
import Logger from '../utils/Logger.js';
import CommonsController from './commonsController.js';

const monthParamSchema = joi
  .object({ month: joi.string().pattern(/^\d{4}-(0[1-9]|1[0-2])$/).required() })
  .unknown(true);

const confirmSchema = joi.object({
  month: joi.string().pattern(/^\d{4}-(0[1-9]|1[0-2])$/).required(),
  salary_transaction_id: joi.number().integer().positive().required(),
  buckets: joi
    .array()
    .items(
      joi.object({
        bucket: joi.string().valid('fixed', 'yearly', 'emergency', 'savings', 'free').required(),
        amount: joi.number().min(0).required(),
        account_to_id: joi.number().integer().positive().allow(null),
      })
    )
    .max(5)
    .required(),
});

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

const getCurrent = handler((userId) => SalaryPlanService.currentSalaryPlan(userId));

const getByMonth = handler(async (userId, req) =>
  SalaryPlanService.getSalaryPlan(userId, (await monthParamSchema.validateAsync(req.params)).month)
);

const confirm = handler(async (userId, req) => {
  const body = await confirmSchema.validateAsync(req.body);
  const id = await SalaryPlanService.confirmSalaryPlan(userId, {
    month: body.month,
    salary_transaction_id: BigInt(body.salary_transaction_id),
    buckets: body.buckets.map((b: { bucket: never; amount: number; account_to_id?: number | null }) => ({
      bucket: b.bucket,
      amount: b.amount,
      account_to_id: b.account_to_id == null ? null : BigInt(b.account_to_id),
    })),
  });
  return { salary_plan_id: id.toString() };
});

export default { getCurrent, getByMonth, confirm };

// Exported for tests
export { confirmSchema, monthParamSchema };
