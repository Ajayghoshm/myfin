import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import APIError from '../../errorHandling/apiError.js';
import DateTimeUtils from '../../utils/DateTimeUtils.js';
import AccountService from '../accountService.js';
import { IST_OFFSET_SECONDS, dayStartIST } from '../insights/insightsPrimitives.js';
import { type ScheduleRow, emiFor, firstEmiDate, schedule } from './loanMath.js';

/**
 * Low-level loan bookkeeping shared by the loan service and the transaction/account services.
 * It must not import TransactionService (which imports the debt services).
 */

type DbClient = Prisma.TransactionClient | typeof prisma;
type PaymentRow = Prisma.debt_paymentsGetPayload<object>;
type DebtRow = Prisma.debtsGetPayload<object>;

/** IST calendar parts of an epoch-seconds instant. */
function istParts(epoch: number) {
  const d = new Date((epoch + IST_OFFSET_SECONDS) * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export const dateEpoch = (date: string) => dayStartIST(date) as number;

/** The loan's schedule in cents: the first EMI is in the start date's IST month, on the EMI day. */
export function loanSchedule(debt: DebtRow): ScheduleRow[] {
  const { year, month } = istParts(Number(debt.start_date));
  const day = debt.emi_day ?? 1;
  const months = debt.tenure_months ?? 1;
  const emi = debt.emi != null ? Number(debt.emi) : emiFor(Number(debt.principal), Number(debt.rate), months);
  return schedule(Number(debt.principal), Number(debt.rate), months, emi, firstEmiDate(year, month, day), day);
}

/** Loans only: installments paid (by number) against the schedule's length. */
export async function loanFullyPaid(debt: DebtRow, db: DbClient): Promise<boolean> {
  const rows = loanSchedule(debt);
  const paid = await db.debt_payments.count({
    where: { debts_debt_id: debt.debt_id, installment_no: { in: rows.map((r) => r.n) } },
  });
  return rows.length > 0 && paid >= rows.length;
}

/**
 * The loan's opening balance can't be deleted on its own (it would leave the loan account wrong):
 * a principal adjustment no payment points at. Delete the loan instead.
 */
export async function assertLoanRowDeletable(
  trx: { transaction_id: bigint; debt_id: bigint | null; debt_role: string | null; is_adjustment: boolean },
  db: DbClient
): Promise<void> {
  if (trx.debt_id == null || trx.debt_role !== 'principal' || !trx.is_adjustment) return;
  const backs = await db.debt_payments.count({ where: { principal_transaction_id: trx.transaction_id } });
  if (backs === 0)
    throw APIError.badRequest("This is a loan's opening balance. Delete the loan instead.");
}


/** Accounts whose balance must be recalculated, keyed by id, from the earliest affected date. */
export type AccountRecalcs = Map<string, { accountId: bigint; from: number }>;

export function addRecalc(recalcs: AccountRecalcs, accountId: bigint | null | undefined, date: number | bigint) {
  if (accountId == null) return;
  const key = String(accountId);
  const from = Number(date);
  const prev = recalcs.get(key);
  if (!prev || from < prev.from) recalcs.set(key, { accountId, from });
}

/** Recalculates balance snapshots and the current balance of each account (except `exclude`). */
export async function recalcAccounts(
  userId: bigint,
  recalcs: AccountRecalcs,
  db: DbClient,
  exclude: bigint[] = []
): Promise<void> {
  const skip = new Set(exclude.map(String));
  const end = DateTimeUtils.getCurrentUnixTimestamp() + 1;
  for (const { accountId, from } of recalcs.values()) {
    if (skip.has(String(accountId))) continue;
    const balance = await AccountService.recalculateBalanceForAccountIncrementally(
      accountId,
      from - 1,
      end,
      db as never
    );
    await AccountService.setNewAccountBalance(userId, accountId, balance, db as never);
  }
}

/** The category to put back on a restored EMI debit, or null if it no longer exists. */
async function restorableCategory(categoryId: bigint | null, db: DbClient) {
  if (categoryId == null) return null;
  const found = await db.categories.findUnique({ where: { category_id: categoryId }, select: { category_id: true } });
  return found ? categoryId : null;
}

/**
 * Reverses what matching or marking an EMI paid did, except to rows in `alreadyGone` (being deleted
 * by the caller): a matched debit gets its original amount and category back and is unlinked, and
 * the principal transfer / manual principal adjustment is deleted. The payment row is deleted.
 * Returns the accounts to recalculate (call `recalcAccounts` once every row change is done).
 */
export async function undoLoanPayment(
  payment: PaymentRow,
  db: DbClient,
  alreadyGone: Set<string> = new Set()
): Promise<AccountRecalcs> {
  const recalcs: AccountRecalcs = new Map();
  await db.debt_payments.delete({ where: { payment_id: payment.payment_id } });

  const principalId = payment.principal_transaction_id;
  if (principalId != null) {
    const row = await db.transactions.findUnique({ where: { transaction_id: principalId } });
    if (row) {
      addRecalc(recalcs, row.accounts_account_from_id, row.date_timestamp);
      addRecalc(recalcs, row.accounts_account_to_id, row.date_timestamp);
      if (!alreadyGone.has(String(principalId))) {
        await db.transaction_has_tags.deleteMany({ where: { transactions_transaction_id: principalId } });
        await db.transactions.delete({ where: { transaction_id: principalId } });
      }
    }
  }

  const interestId = payment.transaction_id;
  if (!payment.manual && interestId != null) {
    const row = await db.transactions.findUnique({ where: { transaction_id: interestId } });
    if (row) {
      addRecalc(recalcs, row.accounts_account_from_id, row.date_timestamp);
      if (!alreadyGone.has(String(interestId))) {
        await db.transactions.update({
          where: { transaction_id: interestId },
          data: {
            amount: payment.original_amount ?? payment.amount,
            categories_category_id: await restorableCategory(payment.original_category_id, db),
            debt_id: null,
            debt_role: null,
          },
        });
      }
    }
  }
  return recalcs;
}

/**
 * Before a loan's interest or principal row is edited: the parts of a matched EMI must stay in step,
 * so its amount, date and accounts can't change (unpay the EMI first). Description, category,
 * entity and tags may change.
 */
export function assertLoanRowEditable(
  old: {
    debt_id: bigint | null;
    debt_role: string | null;
    amount: bigint;
    date_timestamp: bigint;
    accounts_account_from_id: bigint | null;
    accounts_account_to_id: bigint | null;
  },
  next: {
    amount: bigint | number;
    date: bigint | number;
    accountFrom: bigint | number | null | undefined;
    accountTo: bigint | number | null | undefined;
  }
): void {
  if (old.debt_id == null || (old.debt_role !== 'interest' && old.debt_role !== 'principal')) return;
  const same = (a: bigint | number | null | undefined, b: bigint | number | null | undefined) =>
    (a == null ? null : String(a)) === (b == null ? null : String(b));
  const changed =
    !same(old.amount, next.amount) ||
    !same(old.date_timestamp, next.date) ||
    !same(old.accounts_account_from_id, next.accountFrom) ||
    (old.debt_role === 'principal' && !same(old.accounts_account_to_id, next.accountTo));
  if (changed)
    throw APIError.badRequest(
      "This transaction is part of a loan EMI. Unpay the EMI first to change its amount, date or account."
    );
}
