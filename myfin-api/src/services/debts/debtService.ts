import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import { MYFIN } from '../../consts.js';
import APIError from '../../errorHandling/apiError.js';
import ConvertUtils from '../../utils/convertUtils.js';
import { payeeKeySql } from '../insights/insightsPrimitives.js';
import { ownershipSql } from '../insights/typicalMonth.js';
import { type AccountRecalcs, addRecalc, loanFullyPaid, undoLoanPayment } from './loanLedger.js';

/** A paid-off loan may leave this much principal (matched debits within ±₹1 of the EMI). */
const LOAN_RESIDUAL_CENTS = 100;

/**
 * Role of a transaction linked to a debt (`transactions.debt_role`). Only `interest` counts in
 * analytics (see `countsForAnalyticsSql`); every other role is principal moving between people/loans.
 */
export type DebtRole = 'lend' | 'borrow' | 'repayment' | 'disbursement' | 'interest' | 'principal';
export type DebtKind = 'lent' | 'borrowed' | 'loan';
export type PeopleKind = 'lent' | 'borrowed';
export type DebtStatus = 'open' | 'settled';
export type DisplayStatus = 'outstanding' | 'settled' | 'overdue';

export const PEOPLE_KINDS: readonly PeopleKind[] = ['lent', 'borrowed'];

type DbClient = Prisma.TransactionClient | typeof prisma;
type DebtRow = Prisma.debtsGetPayload<object>;
type PaymentRow = Prisma.debt_paymentsGetPayload<object>;

export type DebtPayment = {
  payment_id: string;
  date: number;
  amount: number;
  principal_part: number;
  interest_part: number;
  transaction_id: string | null;
  description: string | null;
  manual: boolean;
};

export type Debt = {
  debt_id: string;
  kind: DebtKind;
  counterparty_name: string;
  counterparty_key: string | null;
  principal: number;
  rate: number;
  repaid: number;
  /** Never below 0 (an over-repayment shows as 0 outstanding). */
  outstanding: number;
  start_date: number;
  due_date: number | null;
  note: string | null;
  status: DebtStatus;
  /** Past due date and not settled; computed, never stored. */
  overdue: boolean;
  display_status: DisplayStatus;
  /** The lend/borrow transaction the entry was created from. */
  transaction_id: string | null;
  payments: DebtPayment[];
};

export type PeopleDebtInput = {
  kind: PeopleKind;
  name: string;
  /** Currency; required without `transaction_id` (otherwise the transaction amount is used). */
  amount?: number;
  /** Epoch seconds; required without `transaction_id`. */
  date?: number;
  due_date?: number | null;
  note?: string | null;
  transaction_id?: number | string | bigint | null;
};

export type DebtUpdateInput = {
  name: string;
  amount?: number;
  date?: number;
  due_date?: number | null;
  note?: string | null;
};

export type RepaymentInput = {
  amount?: number;
  date?: number;
  transaction_id?: number | string | bigint | null;
};

export type RepaymentSuggestion = {
  transaction_id: string;
  description: string;
  amount: number;
  date: number;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);
const cents = (currency: number) => ConvertUtils.convertFloatToBigInteger(currency);
const currency = (c: bigint | number) => ConvertUtils.convertBigIntegerToFloat(BigInt(c));

/**
 * Hand-made counterparty key, built exactly like `payeeKeySql`: upper-cased, spaces collapsed and
 * the PAID TO / RECEIVED FROM / REQUESTED BY / PAYMENT TO prefix removed.
 */
export const nameKey = (name: string) =>
  name
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .replace(/^(PAID TO|RECEIVED FROM|REQUESTED BY|PAYMENT TO) /, '');

/** principal − Σ principal_part, in cents (may be ≤ 0 once over-repaid). */
export function outstandingCents(
  debt: { principal: bigint | number },
  payments: Array<{ principal_part: bigint | number }>
): number {
  return Number(debt.principal) - payments.reduce((sum, p) => sum + Number(p.principal_part), 0);
}

/** Expense rows are lent, income rows borrowed; repayments go the other way. */
const originType = (kind: PeopleKind) =>
  kind === 'lent' ? MYFIN.TRX_TYPES.EXPENSE : MYFIN.TRX_TYPES.INCOME;
const repaymentType = (kind: PeopleKind) =>
  kind === 'lent' ? MYFIN.TRX_TYPES.INCOME : MYFIN.TRX_TYPES.EXPENSE;

async function ownedDebt(userId: bigint, debtId: bigint, db: DbClient = prisma) {
  const debt = await db.debts.findFirst({ where: { debt_id: debtId, users_user_id: userId } });
  if (!debt) throw APIError.notAuthorized();
  return debt;
}

function asPeople(debt: DebtRow): PeopleKind {
  if (!PEOPLE_KINDS.includes(debt.kind as PeopleKind))
    throw APIError.badRequest('This entry is not a lent or borrowed entry.');
  return debt.kind as PeopleKind;
}

/** The user's own transaction with its payee key; 401 when it is not the user's. */
async function ownedTransaction(userId: bigint, transactionId: bigint, db: DbClient = prisma) {
  const rows = await db.$queryRaw<
    Array<{
      transaction_id: bigint;
      type: string;
      amount: bigint;
      date_timestamp: bigint;
      is_adjustment: unknown;
      debt_id: bigint | null;
      yearly_cost_id: bigint | null;
      payee_key: string | null;
    }>
  >`SELECT transactions.transaction_id, transactions.type, transactions.amount,
           transactions.date_timestamp, transactions.is_adjustment, transactions.debt_id,
           transactions.yearly_cost_id,
           ${payeeKeySql} AS payee_key
    ${ownershipSql(userId)}
      AND transactions.transaction_id = ${transactionId}
    LIMIT 1`;
  if (rows.length === 0) throw APIError.notAuthorized();
  const row = rows[0];
  if (Number(row.is_adjustment) === 1) throw APIError.badRequest('A balance adjustment cannot be linked to a debt.');
  if (row.debt_id != null) throw APIError.badRequest('This transaction is already linked to a debt.');
  if (row.yearly_cost_id != null)
    throw APIError.badRequest('This transaction is linked to a yearly cost. Unlink it from the yearly cost first.');
  return row;
}

/** Links a transaction to a debt, failing with 400 if another request linked it first. */
async function linkTransaction(db: DbClient, transactionId: bigint, debtId: bigint, role: DebtRole) {
  const { count } = await db.transactions.updateMany({
    where: { transaction_id: transactionId, debt_id: null, yearly_cost_id: null },
    data: { debt_id: debtId, debt_role: role },
  });
  if (count === 0) throw APIError.badRequest('This transaction is already linked to a debt.');
}

/** Stores `settled` when nothing is outstanding, `open` otherwise. */
export async function refreshDebtStatus(debtId: bigint, db: DbClient = prisma): Promise<void> {
  const debt = await db.debts.findUnique({ where: { debt_id: debtId } });
  if (!debt) return;
  const payments = await db.debt_payments.findMany({ where: { debts_debt_id: debtId } });
  const left = outstandingCents(debt, payments);
  // A loan whose every EMI is paid is settled even with a rounding residual of up to ₹1
  const settled =
    left <= 0 || (debt.kind === 'loan' && left <= LOAN_RESIDUAL_CENTS && (await loanFullyPaid(debt, db)));
  const status: DebtStatus = settled ? 'settled' : 'open';
  if (status !== debt.status) await db.debts.update({ where: { debt_id: debtId }, data: { status } });
}

async function toDtos(rows: DebtRow[], now: number): Promise<Debt[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.debt_id);
  const [payments, origins] = await Promise.all([
    prisma.debt_payments.findMany({
      where: { debts_debt_id: { in: ids } },
      orderBy: [{ date: 'asc' }, { payment_id: 'asc' }],
    }),
    prisma.transactions.findMany({
      where: { debt_id: { in: ids }, debt_role: { in: ['lend', 'borrow'] } },
      select: { debt_id: true, transaction_id: true },
      orderBy: { transaction_id: 'asc' },
    }),
  ]);
  const trxIds = payments.map((p) => p.transaction_id).filter((t): t is bigint => t != null);
  const descriptions = new Map(
    (trxIds.length
      ? await prisma.transactions.findMany({
          where: { transaction_id: { in: trxIds } },
          select: { transaction_id: true, description: true },
        })
      : []
    ).map((t) => [t.transaction_id.toString(), t.description])
  );
  const byDebt = new Map<string, PaymentRow[]>();
  for (const p of payments) {
    const key = p.debts_debt_id.toString();
    byDebt.set(key, [...(byDebt.get(key) ?? []), p]);
  }
  const originOf = new Map<string, string>();
  for (const o of origins) {
    const key = String(o.debt_id);
    if (!originOf.has(key)) originOf.set(key, o.transaction_id.toString());
  }

  return rows.map((d) => {
    const own = byDebt.get(d.debt_id.toString()) ?? [];
    const outstanding = Math.max(0, outstandingCents(d, own));
    const repaid = own.reduce((sum, p) => sum + Number(p.principal_part), 0);
    const status = d.status as DebtStatus;
    const overdue = status !== 'settled' && d.due_date != null && Number(d.due_date) < now;
    return {
      debt_id: d.debt_id.toString(),
      kind: d.kind as DebtKind,
      counterparty_name: d.counterparty_name,
      counterparty_key: d.counterparty_key,
      principal: currency(d.principal),
      rate: Number(d.rate),
      repaid: currency(repaid),
      outstanding: currency(outstanding),
      start_date: Number(d.start_date),
      due_date: d.due_date == null ? null : Number(d.due_date),
      note: d.note,
      status,
      overdue,
      display_status: status === 'settled' ? 'settled' : overdue ? 'overdue' : 'outstanding',
      transaction_id: originOf.get(d.debt_id.toString()) ?? null,
      payments: own.map((p) => ({
        payment_id: p.payment_id.toString(),
        date: Number(p.date),
        amount: currency(p.amount),
        principal_part: currency(p.principal_part),
        interest_part: currency(p.interest_part),
        transaction_id: p.transaction_id == null ? null : p.transaction_id.toString(),
        description:
          p.transaction_id == null ? null : (descriptions.get(p.transaction_id.toString()) ?? null),
        manual: p.manual,
      })),
    };
  });
}

async function debtDto(debtId: bigint, now = nowSeconds()): Promise<Debt> {
  const row = await prisma.debts.findUniqueOrThrow({ where: { debt_id: debtId } });
  return (await toDtos([row], now))[0];
}

/**
 * Money people owe the user and the user owes people, in cents, never below 0 per entry.
 * With `atEpoch`, only entries started and payments dated before it count (e.g. a month end).
 */
export async function peopleTotals(
  userId: bigint,
  atEpoch?: number
): Promise<{ owedToYouCents: number; youOweCents: number }> {
  const debts = await prisma.debts.findMany({
    where: {
      users_user_id: userId,
      kind: { in: [...PEOPLE_KINDS] },
      ...(atEpoch == null ? {} : { start_date: { lt: atEpoch } }),
    },
    include: {
      payments: {
        where: atEpoch == null ? undefined : { date: { lt: atEpoch } },
        select: { principal_part: true },
      },
    },
  });
  let owedToYouCents = 0;
  let youOweCents = 0;
  for (const d of debts) {
    const left = Math.max(0, outstandingCents(d, d.payments));
    if (d.kind === 'lent') owedToYouCents += left;
    else youOweCents += left;
  }
  return { owedToYouCents, youOweCents };
}

export async function listDebts(
  userId: bigint,
  now: number = nowSeconds()
): Promise<{ debts: Debt[]; totals: { owed_to_you: number; you_owe: number } }> {
  const rows = await prisma.debts.findMany({
    where: { users_user_id: userId },
    orderBy: [{ start_date: 'desc' }, { debt_id: 'desc' }],
  });
  const totals = await peopleTotals(userId);
  return {
    debts: await toDtos(rows, now),
    totals: { owed_to_you: currency(totals.owedToYouCents), you_owe: currency(totals.youOweCents) },
  };
}

/** A lent/borrowed entry, by hand or from the transaction that moved the money. */
export async function createPeopleDebt(
  userId: bigint,
  input: PeopleDebtInput,
  now: number = nowSeconds()
): Promise<Debt> {
  if (!PEOPLE_KINDS.includes(input.kind)) throw APIError.badRequest('kind must be lent or borrowed.');
  const name = input.name.trim();
  if (name.length === 0) throw APIError.badRequest('A name is required.');
  const trxId = input.transaction_id == null ? null : BigInt(input.transaction_id);

  const created = await prisma.$transaction(async (tx) => {
    let principal: number;
    let start: number;
    let key: string;
    if (trxId != null) {
      const trx = await ownedTransaction(userId, trxId, tx);
      if (trx.type !== originType(input.kind))
        throw APIError.badRequest(
          input.kind === 'lent'
            ? 'Only an expense can be marked as money lent.'
            : 'Only an income can be marked as money borrowed.'
        );
      principal = Number(trx.amount);
      start = Number(trx.date_timestamp);
      key = trx.payee_key || nameKey(name);
    } else {
      if (input.amount == null || !(input.amount > 0)) throw APIError.badRequest('amount must be positive.');
      if (input.date == null) throw APIError.badRequest('date is required.');
      principal = cents(input.amount);
      start = input.date;
      key = nameKey(name);
    }
    const debt = await tx.debts.create({
      data: {
        users_user_id: userId,
        kind: input.kind,
        counterparty_name: name,
        counterparty_key: key,
        principal,
        start_date: start,
        due_date: input.due_date ?? null,
        note: input.note?.trim() || null,
        created_at: now,
      },
    });
    if (trxId != null)
      await linkTransaction(tx, trxId, debt.debt_id, input.kind === 'lent' ? 'lend' : 'borrow');
    return debt;
  });
  return debtDto(created.debt_id);
}

/**
 * Edits a lent/borrowed entry. An entry made from a transaction keeps that transaction's amount
 * and date (re-read here, in case the transaction was edited) and its payee key.
 */
export async function updateDebt(userId: bigint, debtId: bigint, input: DebtUpdateInput): Promise<Debt> {
  const debt = await ownedDebt(userId, debtId);
  asPeople(debt);
  const name = input.name.trim();
  if (name.length === 0) throw APIError.badRequest('A name is required.');
  const origin = await prisma.transactions.findFirst({
    where: { debt_id: debtId, debt_role: { in: ['lend', 'borrow'] } },
    orderBy: { transaction_id: 'asc' },
  });
  if (input.amount != null && !(input.amount > 0)) throw APIError.badRequest('amount must be positive.');
  await prisma.$transaction(async (tx) => {
    await tx.debts.update({
      where: { debt_id: debtId },
      data: {
        counterparty_name: name,
        ...(origin
          ? { principal: origin.amount, start_date: origin.date_timestamp }
          : {
              counterparty_key: nameKey(name),
              ...(input.amount != null && { principal: cents(input.amount) }),
              ...(input.date != null && { start_date: input.date }),
            }),
        ...(input.due_date !== undefined && { due_date: input.due_date }),
        ...(input.note !== undefined && { note: input.note?.trim() || null }),
      },
    });
    await refreshDebtStatus(debtId, tx);
  });
  return debtDto(debtId);
}

/** Deletes an entry and its repayments; its transactions count again. A loan is undone fully (ruling D3). */
export async function deleteDebt(userId: bigint, debtId: bigint): Promise<void> {
  const debt = await ownedDebt(userId, debtId);
  if (debt.kind === 'loan') {
    // Loaded lazily: the loan service imports TransactionService, which imports this module.
    const { deleteLoan } = await import('./loanService.js');
    await deleteLoan(userId, debtId);
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.transactions.updateMany({
      where: { debt_id: debtId },
      data: { debt_id: null, debt_role: null },
    });
    await tx.debts.delete({ where: { debt_id: debtId } });
  });
}

function assertNotBeforeStart(debt: DebtRow, date: number) {
  if (date < Number(debt.start_date))
    throw APIError.badRequest('A repayment cannot be dated before the entry started.');
}

/** A repayment: linked to a transaction (its amount and date), or manual (e.g. cash). */
export async function addRepayment(userId: bigint, debtId: bigint, input: RepaymentInput): Promise<Debt> {
  const debt = await ownedDebt(userId, debtId);
  const kind = asPeople(debt);
  const trxId = input.transaction_id == null ? null : BigInt(input.transaction_id);
  await prisma.$transaction(async (tx) => {
    if (trxId != null) {
      const trx = await ownedTransaction(userId, trxId, tx);
      if (trx.type !== repaymentType(kind))
        throw APIError.badRequest(
          kind === 'lent'
            ? 'A repayment of money lent must be an income.'
            : 'A repayment of money borrowed must be an expense.'
        );
      assertNotBeforeStart(debt, Number(trx.date_timestamp));
      await linkTransaction(tx, trxId, debtId, 'repayment');
      await tx.debt_payments.create({
        data: {
          debts_debt_id: debtId,
          date: trx.date_timestamp,
          amount: trx.amount,
          principal_part: trx.amount,
          transaction_id: trxId,
          manual: false,
        },
      });
    } else {
      if (input.amount == null || !(input.amount > 0)) throw APIError.badRequest('amount must be positive.');
      if (input.date == null) throw APIError.badRequest('date is required.');
      assertNotBeforeStart(debt, input.date);
      const amount = cents(input.amount);
      await tx.debt_payments.create({
        data: { debts_debt_id: debtId, date: input.date, amount, principal_part: amount, manual: true },
      });
    }
    await refreshDebtStatus(debtId, tx);
  });
  return debtDto(debtId);
}

/** Removes a repayment; a linked transaction counts again. */
export async function deleteRepayment(userId: bigint, debtId: bigint, paymentId: bigint): Promise<Debt> {
  asPeople(await ownedDebt(userId, debtId));
  const payment = await prisma.debt_payments.findFirst({
    where: { payment_id: paymentId, debts_debt_id: debtId },
  });
  if (!payment) throw APIError.notAuthorized();
  await prisma.$transaction(async (tx) => {
    const linked = [payment.transaction_id, payment.principal_transaction_id].filter(
      (t): t is bigint => t != null
    );
    if (linked.length > 0)
      await tx.transactions.updateMany({
        where: { transaction_id: { in: linked }, debt_id: debtId },
        data: { debt_id: null, debt_role: null },
      });
    await tx.debt_payments.delete({ where: { payment_id: paymentId } });
    await refreshDebtStatus(debtId, tx);
  });
  return debtDto(debtId);
}

/**
 * Unlinked rows of the repayment type, on or after the start date, whose payee key equals the
 * entry's counterparty key. Read-only: confirming one calls `addRepayment` with its id.
 */
export async function repaymentSuggestions(userId: bigint, debtId: bigint): Promise<RepaymentSuggestion[]> {
  const debt = await ownedDebt(userId, debtId);
  const kind = asPeople(debt);
  if (debt.status === 'settled' || !debt.counterparty_key) return [];
  const rows = await prisma.$queryRaw<
    Array<{ transaction_id: bigint; description: string | null; amount: bigint; date_timestamp: bigint }>
  >`SELECT transactions.transaction_id, transactions.description, transactions.amount,
           transactions.date_timestamp
    ${ownershipSql(userId)}
      AND transactions.type = ${repaymentType(kind)}
      AND transactions.debt_id IS NULL
      AND transactions.is_adjustment = false
      AND transactions.date_timestamp >= ${debt.start_date}
      AND ${payeeKeySql} = ${debt.counterparty_key}
    ORDER BY transactions.date_timestamp ASC, transactions.transaction_id ASC
    LIMIT 50`;
  return rows.map((r) => ({
    transaction_id: r.transaction_id.toString(),
    description: r.description ?? '',
    amount: currency(r.amount),
    date: Number(r.date_timestamp),
  }));
}

/**
 * After a debt-linked transaction is edited (same prismaTx): an origin row (lend/borrow) sets the
 * entry's principal and start date; a repayment row sets its payment's amount, principal part and
 * date. Then the entry's status is refreshed. Other roles are left to their own flows.
 */
export async function syncEditedTransaction(
  trx: { transaction_id: bigint; debt_id: bigint | null; debt_role: string | null },
  amountCents: number | bigint,
  date: number | bigint,
  db: DbClient = prisma
): Promise<void> {
  if (trx.debt_id == null) return;
  if (trx.debt_role === 'lend' || trx.debt_role === 'borrow') {
    await db.debts.update({
      where: { debt_id: trx.debt_id },
      data: { principal: BigInt(amountCents), start_date: BigInt(date) },
    });
  } else if (trx.debt_role === 'repayment') {
    await db.debt_payments.updateMany({
      where: { debts_debt_id: trx.debt_id, transaction_id: trx.transaction_id },
      data: { amount: BigInt(amountCents), principal_part: BigInt(amountCents), date: BigInt(date) },
    });
  } else {
    return;
  }
  await refreshDebtStatus(trx.debt_id, db);
}

/**
 * Before transactions are deleted: drop repayments they backed (so they stop reducing what is
 * owed) and refresh those entries' status. Lend/borrow rows are unlinked by the FK.
 * A loan EMI backed by a deleted row is unpaid: a deleted principal transfer gives the debit back
 * its original amount; a deleted debit takes its principal transfer with it.
 * Returns accounts whose balance the caller must recalculate once the rows are deleted.
 */
export async function forgetDeletedTransactions(
  transactionIds: bigint[],
  db: DbClient = prisma
): Promise<AccountRecalcs> {
  const recalcs: AccountRecalcs = new Map();
  if (transactionIds.length === 0) return recalcs;
  const payments = await db.debt_payments.findMany({
    where: {
      OR: [{ transaction_id: { in: transactionIds } }, { principal_transaction_id: { in: transactionIds } }],
    },
    include: { debts: { select: { kind: true } } },
  });
  if (payments.length === 0) return recalcs;
  const gone = new Set(transactionIds.map(String));
  const people = payments.filter((p) => p.debts.kind !== 'loan');
  if (people.length > 0)
    await db.debt_payments.deleteMany({ where: { payment_id: { in: people.map((p) => p.payment_id) } } });
  for (const { debts: _debt, ...p } of payments.filter((x) => x.debts.kind === 'loan')) {
    for (const r of (await undoLoanPayment(p, db, gone)).values()) addRecalc(recalcs, r.accountId, r.from);
  }
  for (const debtId of new Set(payments.map((p) => p.debts_debt_id))) await refreshDebtStatus(debtId, db);
  return recalcs;
}

export default {
  outstandingCents,
  peopleTotals,
  listDebts,
  createPeopleDebt,
  updateDebt,
  deleteDebt,
  addRepayment,
  deleteRepayment,
  repaymentSuggestions,
  refreshDebtStatus,
  forgetDeletedTransactions,
  syncEditedTransaction,
};
