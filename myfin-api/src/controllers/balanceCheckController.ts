import type { NextFunction, Request, Response } from 'express';
import joi from 'joi';
import APIError from '../errorHandling/apiError.js';
import BalanceCheckService from '../services/balanceCheckService.js';
import Logger from '../utils/Logger.js';
import CommonsController from './commonsController.js';

const balanceCheckSchema = joi.object({
  account_id: joi.number().integer().positive().required(),
  real_balance: joi.number().required(),
});

const getBalanceCheck = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    res.json(await BalanceCheckService.listForBalanceCheck(sessionData.userId));
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const recordBalanceCheck = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await balanceCheckSchema.validateAsync(req.body);
    res.json(
      await BalanceCheckService.recordCheck(
        sessionData.userId,
        BigInt(input.account_id),
        input.real_balance
      )
    );
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const writeOffBalanceGap = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await balanceCheckSchema.validateAsync(req.body);
    const transactionId = await BalanceCheckService.writeOff(
      sessionData.userId,
      BigInt(input.account_id),
      input.real_balance
    );
    res.json({ transaction_id: String(transactionId) });
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

export default {
  getBalanceCheck,
  recordBalanceCheck,
  writeOffBalanceGap,
};

// Exported for tests
export { balanceCheckSchema };
