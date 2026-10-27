import type { NextFunction, Request, Response } from 'express';
import joi from 'joi';
import APIError from '../errorHandling/apiError.js';
import FinancialProfileService from '../services/financialProfileService.js';
import Logger from '../utils/Logger.js';
import CommonsController from './commonsController.js';

const financialProfileSchema = joi.object({
  salary_category_id: joi.number().integer().positive().allow(null),
  salary_cutoff_day: joi.number().integer().min(1).max(28),
  savings_target_mode: joi.string().valid('amount', 'percent'),
  savings_target_value: joi.number().min(0),
  savings_target_account_id: joi.number().integer().positive().allow(null),
  sinking_fund_account_id: joi.number().integer().positive().allow(null),
  emergency_fund_target_months: joi.number().integer().min(1).max(24),
  emergency_topup_percent: joi.number().integer().min(0).max(100),
  small_spend_cutoff: joi.number().greater(0).max(100000),
});

const getFinancialProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    res.json(await FinancialProfileService.getFinancialProfile(sessionData.userId));
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const updateFinancialProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await financialProfileSchema.validateAsync(req.body);
    res.json(await FinancialProfileService.updateFinancialProfile(sessionData.userId, input));
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

export default {
  getFinancialProfile,
  updateFinancialProfile,
};

// Exported for tests
export { financialProfileSchema };
