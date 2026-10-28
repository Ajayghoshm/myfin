import type { NextFunction, Request, Response } from 'express';
import joi from 'joi';
import APIError from '../errorHandling/apiError.js';
import EventService, { EVENT_KINDS, EVENT_REPEATS, MAX_EVENT_NAME } from '../services/routines/eventService.js';
import Logger from '../utils/Logger.js';
import CommonsController from './commonsController.js';

const DATE = joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);
const ID = joi.number().integer().positive();

const eventSchema = joi.object({
  name: joi.string().trim().min(1).max(MAX_EVENT_NAME).required(),
  kind: joi
    .string()
    .valid(...EVENT_KINDS)
    .required(),
  date: DATE.required(),
  repeat: joi
    .string()
    .valid(...EVENT_REPEATS)
    .required(),
  amount: joi.number().min(0).allow(null),
  gift_budget: joi.number().min(0).allow(null),
  account_id: ID.allow(null),
  category_id: ID.allow(null),
  payee_key: joi.string().trim().max(255).allow(null, ''),
  active: joi.boolean(),
});

const createEventSchema = eventSchema.keys({ source_key: joi.string().max(255).allow(null) });

const idParamSchema = joi.object({ id: ID.required() }).unknown(true);
const occurrenceParamSchema = joi
  .object({ eventId: ID.required(), date: DATE.required(), transactionId: ID })
  .unknown(true);
const upcomingQuerySchema = joi.object({ days: joi.number().integer().min(1).max(366).default(30) }).unknown(true);
const doneSchema = joi.object({ done: joi.boolean().required() });
const linkSchema = joi.object({ transaction_id: ID.required() });
const dismissSchema = joi.object({ key: joi.string().min(1).max(255).required() });

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

const eventId = async (req: Request) => BigInt((await idParamSchema.validateAsync(req.params)).id);
const occurrenceParams = async (req: Request) => {
  const p = await occurrenceParamSchema.validateAsync(req.params);
  return {
    eventId: BigInt(p.eventId),
    date: p.date as string,
    transactionId: p.transactionId != null ? BigInt(p.transactionId) : null,
  };
};

const getEvents = handler((userId) => EventService.listEvents(userId));

const createEvent = handler(async (userId, req) =>
  EventService.createEvent(userId, await createEventSchema.validateAsync(req.body))
);

const updateEvent = handler(async (userId, req) =>
  EventService.updateEvent(userId, await eventId(req), await eventSchema.validateAsync(req.body))
);

const deleteEvent = handler(async (userId, req) => {
  await EventService.deleteEvent(userId, await eventId(req));
  return { ok: true };
});

const getUpcoming = handler(async (userId, req) => {
  const { days } = await upcomingQuerySchema.validateAsync(req.query);
  return EventService.upcoming(userId, days);
});

const setOccurrenceDone = handler(async (userId, req) => {
  const p = await occurrenceParams(req);
  const { done } = await doneSchema.validateAsync(req.body ?? {});
  return EventService.setOccurrenceDone(userId, p.eventId, p.date, done);
});

const linkTransaction = handler(async (userId, req) => {
  const p = await occurrenceParams(req);
  const { transaction_id } = await linkSchema.validateAsync(req.body ?? {});
  return EventService.linkTransaction(userId, p.eventId, p.date, BigInt(transaction_id));
});

const unlinkTransaction = handler(async (userId, req) => {
  const p = await occurrenceParams(req);
  if (p.transactionId == null) throw APIError.badRequest('A transaction id is required.');
  return EventService.unlinkTransaction(userId, p.eventId, p.date, p.transactionId);
});

const getSuggestions = handler((userId) => EventService.suggestions(userId));

const dismissSuggestion = handler(async (userId, req) => {
  const { key } = await dismissSchema.validateAsync(req.body ?? {});
  await EventService.dismissSuggestion(userId, key);
  return { ok: true };
});

export default {
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  getUpcoming,
  setOccurrenceDone,
  linkTransaction,
  unlinkTransaction,
  getSuggestions,
  dismissSuggestion,
};

// Exported for tests
export { eventSchema, createEventSchema, upcomingQuerySchema, doneSchema, linkSchema, dismissSchema };
