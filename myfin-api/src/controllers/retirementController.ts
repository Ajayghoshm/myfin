import type { NextFunction, Request, Response } from 'express';
import joi from 'joi';
import APIError from '../errorHandling/apiError.js';
import { getRetirement, saveWhatIf } from '../services/wealth/retirementService.js';
import Logger from '../utils/Logger.js';
import CommonsController from './commonsController.js';

const overridesSchema = joi.object({
  returnPct: joi.number().min(0).max(30),
  inflationPct: joi.number().min(0).max(20),
  swrPct: joi.number().min(1).max(10),
  retirementAge: joi.number().integer().min(1).max(80),
  monthlyInvestment: joi.number().min(0).max(100_000_000),
});

const whatIfSchema = joi.object({ overrides: overridesSchema.default({}) });

const getRetirementFigures = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    res.json(await getRetirement(sessionData.userId));
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const whatIf = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await whatIfSchema.validateAsync(req.body ?? {});
    res.json(await getRetirement(sessionData.userId, { overrides: input.overrides }));
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const saveWhatIfSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await whatIfSchema.validateAsync(req.body ?? {});
    await saveWhatIf(sessionData.userId, input.overrides);
    res.json(await getRetirement(sessionData.userId));
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

export default { getRetirementFigures, whatIf, saveWhatIfSettings };

// Exported for tests
export { overridesSchema, whatIfSchema };
