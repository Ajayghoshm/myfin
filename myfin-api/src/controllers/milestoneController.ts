import type { NextFunction, Request, Response } from 'express';
import joi from 'joi';
import APIError from '../errorHandling/apiError.js';
import MilestoneService from '../services/routines/milestoneService.js';
import Logger from '../utils/Logger.js';
import CommonsController from './commonsController.js';

const idParamSchema = joi.object({ id: joi.number().integer().positive().required() }).unknown(true);

const handler =
  (fn: (userId: bigint, req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionData = await CommonsController.checkAuthSessionValidity(req);
      res.json(await fn(sessionData.userId, req));
    } catch (err) {
      Logger.addErrorLog(err);
      next(err || APIError.internalServerError());
    }
  };

const evaluateMilestones = handler((userId) => MilestoneService.evaluateMilestones(userId));

const getMilestones = handler((userId) => MilestoneService.listMilestones(userId));

const dismissMilestone = handler(async (userId, req) => {
  const { id } = await idParamSchema.validateAsync(req.params);
  return MilestoneService.dismissMilestone(userId, BigInt(id));
});

export default { evaluateMilestones, getMilestones, dismissMilestone };

// Exported for tests
export { idParamSchema };
