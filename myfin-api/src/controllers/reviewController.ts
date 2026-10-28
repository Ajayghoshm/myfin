import type { NextFunction, Request, Response } from 'express';
import joi from 'joi';
import APIError from '../errorHandling/apiError.js';
import { monthOfIST } from '../services/routines/monthlyRecordService.js';
import MonthReviewService from '../services/routines/monthReviewService.js';
import Logger from '../utils/Logger.js';
import CommonsController from './commonsController.js';

const MONTH = joi.string().pattern(/^\d{4}-(0[1-9]|1[0-2])$/);
const reviewQuerySchema = joi.object({ month: MONTH.optional() }).unknown(true);
const reviewedSchema = joi.object({ month: MONTH.required(), reviewed: joi.boolean().required() });

const parseMonth = (m: string) => ({ year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) });

const getReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await reviewQuerySchema.validateAsync(req.query);
    const now = Math.floor(Date.now() / 1000);
    const cur = monthOfIST(now);
    const ym = input.month
      ? parseMonth(input.month)
      : { year: cur.month === 1 ? cur.year - 1 : cur.year, month: cur.month === 1 ? 12 : cur.month - 1 };
    res.json(await MonthReviewService.monthReview(sessionData.userId, ym, now));
  } catch (err) {
    Logger.addErrorLog(err);
    next(err || APIError.internalServerError());
  }
};

const setReviewed = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await reviewedSchema.validateAsync({ month: req.params.month, reviewed: req.body?.reviewed });
    await MonthReviewService.setReviewed(sessionData.userId, parseMonth(input.month), input.reviewed);
    res.json({ month: input.month, reviewed: input.reviewed });
  } catch (err) {
    Logger.addErrorLog(err);
    next(err || APIError.internalServerError());
  }
};

const getReviewHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    res.json(await MonthReviewService.reviewHistory(sessionData.userId));
  } catch (err) {
    Logger.addErrorLog(err);
    next(err || APIError.internalServerError());
  }
};

export default { getReview, setReviewed, getReviewHistory };

// Exported for tests
export { reviewQuerySchema, reviewedSchema };
