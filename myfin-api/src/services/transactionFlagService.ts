import { prisma } from '../config/prisma.js';
import { MYFIN } from '../consts.js';
import APIError from '../errorHandling/apiError.js';
import { createPeopleDebt } from './debts/debtService.js';
import { addDays, daysBetween, istDate } from './routines/eventDates.js';
import { createEvent, linkTransaction, occurrencesBetween } from './routines/eventService.js';

export type TransactionFlags = {
  loan?: { name?: string; due_date?: number | null };
  event?: { event_id: string } | { new_event: { name: string; kind?: string } };
};
export type FlagItem = { transaction_id: string; flags: TransactionFlags };
export type FlagResult = {
  applied: number;
  failed: Array<{ transaction_id: string; flag: 'loan' | 'event'; message: string }>;
};

// An occurrence further than this from the transaction is never the nearest one in practice
const OCCURRENCE_WINDOW_DAYS = 400;

async function ownedTransaction(userId: bigint, transactionId: bigint) {
  const trx = await prisma.transactions.findFirst({
    where: {
      transaction_id: transactionId,
      OR: [
        { accounts_transactions_accounts_account_from_idToaccounts: { users_user_id: userId } },
        { accounts_transactions_accounts_account_to_idToaccounts: { users_user_id: userId } },
      ],
    },
    select: { type: true, description: true, date_timestamp: true },
  });
  if (!trx) throw APIError.notAuthorized();
  return trx;
}

async function applyLoan(userId: bigint, transactionId: bigint, loan: NonNullable<TransactionFlags['loan']>) {
  const trx = await ownedTransaction(userId, transactionId);
  await createPeopleDebt(userId, {
    kind: trx.type === MYFIN.TRX_TYPES.INCOME ? 'borrowed' : 'lent',
    name: loan.name?.trim() || (trx.description ?? '').trim(),
    due_date: loan.due_date ?? null,
    transaction_id: transactionId,
  });
}

async function applyEvent(userId: bigint, transactionId: bigint, event: NonNullable<TransactionFlags['event']>) {
  const trx = await ownedTransaction(userId, transactionId);
  const day = istDate(Number(trx.date_timestamp));
  let eventId: bigint;
  let target: { date: string; repeat: string };
  if ('new_event' in event) {
    const created = await createEvent(userId, {
      name: event.new_event.name,
      kind: event.new_event.kind ?? 'other',
      date: day,
      repeat: 'once',
    });
    eventId = BigInt(created.event_id);
    target = created;
  } else {
    eventId = BigInt(event.event_id);
    const row = await prisma.events.findFirst({ where: { event_id: eventId, users_user_id: userId } });
    if (!row) throw APIError.notAuthorized();
    target = row;
  }
  const near = occurrencesBetween(target, addDays(day, -OCCURRENCE_WINDOW_DAYS), addDays(day, OCCURRENCE_WINDOW_DAYS));
  if (near.length === 0) throw APIError.badRequest('This event has no occurrence near the transaction.');
  const date = near.reduce((best, d) => (Math.abs(daysBetween(day, d)) < Math.abs(daysBetween(day, best)) ? d : best));
  await linkTransaction(userId, eventId, date, transactionId);
}

/** Marks transactions as loans and/or links them to events. A failing flag is reported and never stops the rest. */
export async function applyFlags(userId: bigint, items: FlagItem[]): Promise<FlagResult> {
  const result: FlagResult = { applied: 0, failed: [] };
  for (const item of items) {
    const attempt = async (flag: 'loan' | 'event', run: () => Promise<void>) => {
      try {
        await run();
        result.applied++;
      } catch (err) {
        result.failed.push({
          transaction_id: item.transaction_id,
          flag,
          message: err instanceof Error ? err.message : 'Could not apply the flag.',
        });
      }
    };
    let transactionId: bigint;
    try {
      transactionId = BigInt(item.transaction_id);
    } catch {
      for (const flag of ['loan', 'event'] as const)
        if (item.flags[flag]) result.failed.push({ transaction_id: item.transaction_id, flag, message: 'Invalid transaction id.' });
      continue;
    }
    if (item.flags.loan) {
      const loan = item.flags.loan;
      await attempt('loan', () => applyLoan(userId, transactionId, loan));
    }
    if (item.flags.event) {
      const event = item.flags.event;
      await attempt('event', () => applyEvent(userId, transactionId, event));
    }
  }
  return result;
}

export default { applyFlags };
