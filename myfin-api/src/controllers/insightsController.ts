import type { NextFunction, Request, Response } from 'express';
import joi from 'joi';
import APIError from '../errorHandling/apiError.js';
import InsightsService from '../services/insights/insightsService.js';
import Logger from '../utils/Logger.js';
import CommonsController from './commonsController.js';

const monthInsightsSchema = joi
  .object({
    year: joi.number().integer().min(2000).max(2100).required(),
    month: joi.number().integer().min(1).max(12).required(),
  })
  .unknown(true);

const getMonthInsights = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await monthInsightsSchema.validateAsync(req.query);
    const data = await InsightsService.getMonthInsights(sessionData.userId, {
      year: input.year,
      month: input.month,
    });
    res.json(data);
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const payeeClassificationSchema = joi.object({
  payee_key: joi.string().min(1).max(255).required(),
  kind: joi.string().valid('person', 'merchant').allow(null).required(),
});

const setPayeeClassification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await payeeClassificationSchema.validateAsync(req.body);
    await InsightsService.setPayeeClassification(sessionData.userId, input.payee_key, input.kind);
    res.json({ ok: true });
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

export default {
  getMonthInsights,
  setPayeeClassification,
};

// Exported for tests
export { monthInsightsSchema, payeeClassificationSchema };
