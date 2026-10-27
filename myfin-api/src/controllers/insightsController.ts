import type { NextFunction, Request, Response } from 'express';
import joi from 'joi';
import APIError from '../errorHandling/apiError.js';
import { emergencyFund } from '../services/planning/emergencyFundService.js';
import {
  budgetCompare,
  forecast,
  forecastToBudget,
  parseForecastMonth,
} from '../services/planning/forecastService.js';
import { dailySpend } from '../services/insights/dailySpendService.js';
import { dayStartIST } from '../services/insights/insightsPrimitives.js';
import { smallSpends } from '../services/insights/smallSpendService.js';
import { safeToSpend } from '../services/planning/safeToSpendService.js';
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

const getEmergencyFund = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    res.json(await emergencyFund(sessionData.userId));
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const getSmallSpends = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await forecastQuerySchema.validateAsync(req.query);
    res.json(await smallSpends(sessionData.userId, parseForecastMonth(input.month)));
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const realDay = joi
  .string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((v, helpers) => (dayStartIST(v) == null ? helpers.error('any.invalid') : v));

const dailySpendQuerySchema = joi
  .object({
    from: realDay.required(),
    to: realDay.required(),
    flexible_only: joi.boolean().truthy('1').falsy('0', '').default(false),
  })
  .unknown(true);

const getDailySpend = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await dailySpendQuerySchema.validateAsync(req.query);
    res.json(await dailySpend(sessionData.userId, input.from, input.to, input.flexible_only));
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const getSafeToSpend = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    res.json(await safeToSpend(sessionData.userId));
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const forecastQuerySchema = joi.object({ month: joi.string().pattern(/^\d{4}-(0[1-9]|1[0-2])$/).required() }).unknown(true);
const forecastBudgetSchema = joi.object({
  month: joi.string().pattern(/^\d{4}-(0[1-9]|1[0-2])$/).required(),
  mode: joi.string().valid('create', 'replace', 'fill_empty').required(),
});

const getForecast = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await forecastQuerySchema.validateAsync(req.query);
    res.json(await forecast(sessionData.userId, parseForecastMonth(input.month)));
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const getForecastBudgetCompare = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await forecastQuerySchema.validateAsync(req.query);
    res.json(await budgetCompare(sessionData.userId, parseForecastMonth(input.month)));
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const createBudgetFromForecast = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await forecastBudgetSchema.validateAsync(req.body);
    res.json(await forecastToBudget(sessionData.userId, parseForecastMonth(input.month), input.mode));
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
  getEmergencyFund,
  getSafeToSpend,
  getSmallSpends,
  getDailySpend,
  getForecast,
  getForecastBudgetCompare,
  createBudgetFromForecast,
  setPayeeClassification,
};

// Exported for tests
export { dailySpendQuerySchema, forecastBudgetSchema, forecastQuerySchema, monthInsightsSchema, payeeClassificationSchema };
