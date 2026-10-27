import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import { MYFIN } from '../../consts.js';
import APIError from '../../errorHandling/apiError.js';
import ConvertUtils from '../../utils/convertUtils.js';
import AccountService from '../accountService.js';
import { ownershipSql } from '../insights/typicalMonth.js';
import TransactionService from '../transactionService.js';
import { nameKey, refreshDebtStatus } from './debtService.js';
import {
  type AccountRecalcs,
  addRecalc,
  dateEpoch,
  loanSchedule,
  recalcAccounts,
  undoLoanPayment,
} from './loanLedger.js';
import { emiFor, prepaymentWhatIf } from './loanMath.js';

export { loanSchedule };

/**
 * Formal loans (debts.kind = 'loan'): a per-loan LOANAC account opened at −principal, an amortisation
 * schedule, and EMIs that are matched to a real bank debit (split into an interest expense plus a
 * principal transfer into the loan account) or marked paid manually (a principal adjustment on the
 * loan account; the bank is untouched). Only the interest part counts as spending (ruling R-D1).
 */

type Tx = Prisma.TransactionClient;
type DebtRow = Prisma.debtsGetPayload<object>;
type PaymentRow = Prisma.debt_paymentsGetPayload<object>;

const DAY = 86_400;
/** An unpaid installment more than this many days past its date is missed. */
export const MISSED_AFTER_DAYS = 5;
/** A debit matches an EMI when within this many cents of it (±₹1). */
export const MATCH_TOLERANCE_CENTS = 100;
/** Suggestions look this many days either side of an installment date. */
const SUGGESTION_WINDOW_DAYS = 10;
const INTEREST_CATEGORY_NAME = 'Loan interest';
const OPENING_DESCRIPTION = 'Loan opening balance';

export type InstallmentStatus = 'paid' | 'due' | 'missed';

export type Installment = {
  n: number;
  /** YYYY-MM-DD (IST). */
  date: string;
  /** Epoch seconds of the start of that IST day. */
  date_epoch: number;
  emi: number;
  interest: number;
  principal: number;
  /** Principal left after this installment, per the schedule. */
  balance: number;
  status: InstallmentStatus;
  paid_via: 'matched' | 'manual' | null;
  paid_date: number | null;
  payment_id: string | null;
  /** The matched debit (now the interest row). */
  transaction_id: string | null;
};

export type Loan = {
  debt_id: string;
  kind: 'loan';
  lender: string;
  principal: number;
  rate: number;
  tenure_months: number;
  emi: number;
  emi_day: number;
  account_id: string | null;
  loan_account_id: string | null;
  start_date: number;
  status: 'open' | 'settled';
  outstanding_principal: number;
  interest_paid: number;
  emis_paid: number;
  emis_left: number;
  missed_count: number;
  /** Date of the last scheduled EMI (YYYY-MM-DD). */
  end_date: string;
  next_due: { n: number; date: string; emi: number } | null;
  /** The income the loan was paid out into, if linked. */
  disbursement: TransactionRef | null;
  schedule: Installment[];
};

export type TransactionRef = {
  transaction_id: string;
  description: string;
  amount: number;
  date: number;
};

export type LoanInput = {
  lender: string;
  /** Currency. */
  principal: number;
  /** Percent per year (0 allowed). */
  rate: number;
  tenure_months: number;
  /** Currency; computed from principal, rate and tenure when omitted. */
  emi?: number | null;
  emi_day: number;
  /** The paying account. */
  account_id: number | string | bigint;
  /** Epoch seconds; its IST month is the first EMI's month. */
  start_date: number;
  disbursement_transaction_id?: number | string | bigint | null;
};

/** Expenses and incomes that may be linked are never on a loan or investment account. */
const NOT_LOAN_OR_INVEST = [MYFIN.ACCOUNT_TYPES.LOAN, MYFIN.ACCOUNT_TYPES.INVESTING];

export type MatchSuggestion = {
  n: number;
  transaction_id: string;
  description: string;
  amount: number;
  date: number;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);
const cents = (amount: number) => ConvertUtils.convertFloatToBigInteger(amount);
const currency = (c: bigint | number) => ConvertUtils.convertBigIntegerToFloat(BigInt(c));

async function ownedLoan(userId: bigint, debtId: bigint, db: Tx | typeof prisma = prisma) {
  const debt = await db.debts.findFirst({ where: { debt_id: debtId, users_user_id: userId } });
  if (!debt) throw APIError.notAuthorized();
  if (debt.kind !== 'loan') throw APIError.badRequest('This entry is not a loan.');
  return debt;
}

/** Locks the loan row for the rest of the transaction, so two requests can't pay one installment twice. */
async function lockLoan(userId: bigint, debtId: bigint, tx: Tx) {
  await tx.$queryRaw`SELECT debt_id FROM debts WHERE debt_id = ${debtId} FOR UPDATE`;
  return ownedLoan(userId, debtId, tx);
}

function installment(debt: DebtRow, n: number) {
  const row = loanSchedule(debt).find((r) => r.n === n);
  if (!row) throw APIError.badRequest('There is no such installment.');
  return row;
}

async function interestCategory(userId: bigint, tx: Tx) {
  const found = await tx.categories.findFirst({
    where: { users_user_id: userId, name: INTEREST_CATEGORY_NAME, type: MYFIN.TRX_TYPES.EXPENSE },
  });
  if (found) return found.category_id;
  try {
    const created = await tx.categories.create({
      data: { users_user_id: userId, name: INTEREST_CATEGORY_NAME, type: MYFIN.TRX_TYPES.EXPENSE },
    });
    return created.category_id;
  } catch (err) {
    // Another request created it first (unique user/type/name): use that one
    if ((err as { code?: string })?.code !== 'P2002') throw err;
    const again = await tx.categories.findFirstOrThrow({
      where: { users_user_id: userId, name: INTEREST_CATEGORY_NAME, type: MYFIN.TRX_TYPES.EXPENSE },
    });
    return again.category_id;
  }
}

function toLoan(debt: DebtRow, payments: PaymentRow[], disbursement: TransactionRef | null, now: number): Loan {
  const rows = loanSchedule(debt);
  const byN = new Map(payments.filter((p) => p.installment_no != null).map((p) => [p.installment_no, p]));
  const missedBefore = now - MISSED_AFTER_DAYS * DAY;
  const schedule: Installment[] = rows.map((r) => {
    const p = byN.get(r.n);
    const epoch = dateEpoch(r.date);
    return {
      n: r.n,
      date: r.date,
      date_epoch: epoch,
      emi: currency(r.emi),
      interest: currency(r.interest),
      principal: currency(r.principal),
      balance: currency(r.balance),
      status: p ? 'paid' : epoch < missedBefore ? 'missed' : 'due',
      paid_via: p ? (p.manual ? 'manual' : 'matched') : null,
      paid_date: p ? Number(p.date) : null,
      payment_id: p ? p.payment_id.toString() : null,
      transaction_id: p && !p.manual && p.transaction_id != null ? p.transaction_id.toString() : null,
    };
  });
  const repaid = payments.reduce((s, p) => s + Number(p.principal_part), 0);
  const interest = payments.reduce((s, p) => s + Number(p.interest_part), 0);
  const unpaid = schedule.filter((r) => r.status !== 'paid');
  const next = unpaid[0];
  return {
    debt_id: debt.debt_id.toString(),
    kind: 'loan',
    lender: debt.counterparty_name,
    principal: currency(debt.principal),
    rate: Number(debt.rate),
    tenure_months: debt.tenure_months ?? rows.length,
    emi: currency(rows[0]?.emi ?? 0),
    emi_day: debt.emi_day ?? 1,
    account_id: debt.account_id?.toString() ?? null,
    loan_account_id: debt.loan_account_id?.toString() ?? null,
    start_date: Number(debt.start_date),
    status: debt.status === 'settled' ? 'settled' : 'open',
    outstanding_principal: currency(Math.max(0, Number(debt.principal) - repaid)),
    interest_paid: currency(interest),
    emis_paid: schedule.length - unpaid.length,
    emis_left: unpaid.length,
    missed_count: unpaid.filter((r) => r.status === 'missed').length,
    end_date: rows[rows.length - 1]?.date ?? '',
    next_due: next ? { n: next.n, date: next.date, emi: next.emi } : null,
    disbursement,
    schedule,
  };
}

const toRef = (t: {
  transaction_id: bigint;
  description: string | null;
  amount: bigint;
  date_timestamp: bigint;
}): TransactionRef => ({
  transaction_id: t.transaction_id.toString(),
  description: t.description ?? '',
  amount: currency(t.amount),
  date: Number(t.date_timestamp),
});

async function loansDto(rows: DebtRow[], now: number): Promise<Loan[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.debt_id);
  const [payments, disbursements] = await Promise.all([
    prisma.debt_payments.findMany({
      where: { debts_debt_id: { in: ids } },
      orderBy: [{ installment_no: 'asc' }, { payment_id: 'asc' }],
    }),
    prisma.transactions.findMany({
      where: { debt_id: { in: ids }, debt_role: 'disbursement' },
      orderBy: { transaction_id: 'asc' },
    }),
  ]);
  return rows.map((d) => {
    const disb = disbursements.find((t) => t.debt_id === d.debt_id);
    return toLoan(
      d,
      payments.filter((p) => p.debts_debt_id === d.debt_id),
      disb ? toRef(disb) : null,
      now
    );
  });
}

export async function getLoan(userId: bigint, debtId: bigint, now: number = nowSeconds()): Promise<Loan> {
  const debt = await ownedLoan(userId, debtId);
  return (await loansDto([debt], now))[0];
}

export async function listLoans(userId: bigint, now: number = nowSeconds()): Promise<Loan[]> {
  const rows = await prisma.debts.findMany({
    where: { users_user_id: userId, kind: 'loan' },
    orderBy: [{ start_date: 'desc' }, { debt_id: 'desc' }],
  });
  return loansDto(rows, now);
}

/**
 * Creates the loan, its LOANAC account (named after the lender) opened with one adjustment expense
 * of the principal ("Loan opening balance"), and marks the optional disbursement income.
 */
export async function createLoan(userId: bigint, input: LoanInput, now: number = nowSeconds()): Promise<Loan> {
  const lender = input.lender.trim();
  if (lender.length === 0) throw APIError.badRequest('A lender is required.');
  if (!(input.principal > 0)) throw APIError.badRequest('principal must be positive.');
  if (!(input.rate >= 0)) throw APIError.badRequest('rate cannot be negative.');
  if (!Number.isInteger(input.tenure_months) || input.tenure_months < 1 || input.tenure_months > 600)
    throw APIError.badRequest('tenure_months must be between 1 and 600.');
  if (!Number.isInteger(input.emi_day) || input.emi_day < 1 || input.emi_day > 31)
    throw APIError.badRequest('emi_day must be between 1 and 31.');
  const principal = cents(input.principal);
  const emi = input.emi != null ? cents(input.emi) : emiFor(principal, input.rate, input.tenure_months);
  const firstInterest = Math.round((principal * input.rate) / 1200);
  if (!(emi > firstInterest)) throw APIError.badRequest('The EMI must be more than the monthly interest.');
  const accountId = BigInt(input.account_id);
  const disbursementId =
    input.disbursement_transaction_id == null ? null : BigInt(input.disbursement_transaction_id);

  const debtId = await prisma.$transaction(
    async (tx) => {
      const paying = await tx.accounts.findFirst({ where: { account_id: accountId, users_user_id: userId } });
      if (!paying) throw APIError.notAuthorized();
      if (paying.type === MYFIN.ACCOUNT_TYPES.LOAN)
        throw APIError.badRequest('A loan account cannot be the paying account.');

      const loanAccount = await AccountService.createAccount(
        {
          name: await freeAccountName(userId, lender, tx),
          type: MYFIN.ACCOUNT_TYPES.LOAN,
          description: 'Loan',
          status: MYFIN.ACCOUNT_STATUS.ACTIVE,
          exclude_from_budgets: true,
          current_balance: 0,
          users_user_id: userId,
          created_timestamp: now,
          updated_timestamp: now,
        } as never,
        userId,
        tx as never
      );
      const debt = await tx.debts.create({
        data: {
          users_user_id: userId,
          kind: 'loan',
          counterparty_name: lender,
          counterparty_key: nameKey(lender),
          principal,
          rate: String(input.rate),
          tenure_months: input.tenure_months,
          emi,
          emi_day: input.emi_day,
          account_id: accountId,
          loan_account_id: loanAccount.account_id,
          start_date: input.start_date,
          created_at: now,
        },
      });
      // Dated no later than the first EMI, so the loan account never shows a positive balance
      const firstEmi = dateEpoch(loanSchedule(debt)[0].date);
      await TransactionService.createTransaction(
        userId,
        {
          amount: input.principal,
          type: MYFIN.TRX_TYPES.EXPENSE,
          description: OPENING_DESCRIPTION,
          account_from_id: loanAccount.account_id,
          date_timestamp: Math.min(input.start_date, firstEmi),
          is_essential: false,
          is_adjustment: true,
          debt_id: debt.debt_id,
          debt_role: 'principal',
        },
        tx as never
      );

      if (disbursementId != null) await linkDisbursementInTx(userId, debt.debt_id, disbursementId, tx);
      return debt.debt_id;
    },
    { timeout: 30_000 }
  );
  return getLoan(userId, debtId, now);
}

/** Account names are unique per user: "<lender>", else "<lender> loan", "<lender> loan 2", … */
async function freeAccountName(userId: bigint, lender: string, tx: Tx) {
  const taken = new Set(
    (
      await tx.accounts.findMany({
        where: { users_user_id: userId, name: { startsWith: lender } },
        select: { name: true },
      })
    ).map((a) => a.name.toLowerCase())
  );
  const candidates = [lender, `${lender} loan`];
  for (let i = 2; i < 1000; i++) candidates.push(`${lender} loan ${i}`);
  const name = candidates.find((c) => !taken.has(c.toLowerCase()));
  if (!name) throw APIError.badRequest('Pick a different lender name.');
  return name;
}

/** Marks the user's own unlinked, non-adjustment income as the loan's disbursement. */
async function linkDisbursementInTx(userId: bigint, debtId: bigint, transactionId: bigint, tx: Tx) {
  const rows = await tx.$queryRaw<Array<{ type: string; is_adjustment: unknown }>>`
    SELECT transactions.type, transactions.is_adjustment
    ${ownershipSql(userId)} AND transactions.transaction_id = ${transactionId} LIMIT 1`;
  if (rows.length === 0) throw APIError.notAuthorized();
  if (rows[0].type !== MYFIN.TRX_TYPES.INCOME || Number(rows[0].is_adjustment) === 1)
    throw APIError.badRequest('Only an income can be the loan disbursement.');
  const { count } = await tx.transactions.updateMany({
    where: { transaction_id: transactionId, debt_id: null, yearly_cost_id: null },
    data: { debt_id: debtId, debt_role: 'disbursement' },
  });
  if (count === 0) throw APIError.badRequest('This transaction is already linked to a debt or yearly cost.');
}

/** Links (or replaces) the income the loan was paid out into; it stops counting as income. */
export async function linkDisbursement(
  userId: bigint,
  debtId: bigint,
  transactionId: number | string | bigint,
  now: number = nowSeconds()
): Promise<Loan> {
  await prisma.$transaction(async (tx) => {
    await lockLoan(userId, debtId, tx);
    await tx.transactions.updateMany({
      where: { debt_id: debtId, debt_role: 'disbursement' },
      data: { debt_id: null, debt_role: null },
    });
    await linkDisbursementInTx(userId, debtId, BigInt(transactionId), tx);
  });
  return getLoan(userId, debtId, now);
}

/** Unlinks the disbursement; it counts as income again. */
export async function unlinkDisbursement(userId: bigint, debtId: bigint, now: number = nowSeconds()): Promise<Loan> {
  await prisma.$transaction(async (tx) => {
    await lockLoan(userId, debtId, tx);
    await tx.transactions.updateMany({
      where: { debt_id: debtId, debt_role: 'disbursement' },
      data: { debt_id: null, debt_role: null },
    });
  });
  return getLoan(userId, debtId, now);
}

/** Unlinked, non-adjustment incomes within 30 days of `date` (any amount): the loan's payout. */
export async function disbursementCandidates(userId: bigint, date: number): Promise<TransactionRef[]> {
  const window = 30 * DAY;
  const rows = await prisma.$queryRaw<
    Array<{ transaction_id: bigint; description: string | null; amount: bigint; date_timestamp: bigint }>
  >`SELECT transactions.transaction_id, transactions.description, transactions.amount, transactions.date_timestamp
    ${ownershipSql(userId)}
      AND transactions.type = ${MYFIN.TRX_TYPES.INCOME}
      AND transactions.debt_id IS NULL
      AND transactions.yearly_cost_id IS NULL
      AND transactions.is_adjustment = false
      AND transactions.date_timestamp BETWEEN ${date - window} AND ${date + window}
    ORDER BY transactions.amount DESC, transactions.date_timestamp ASC
    LIMIT 50`;
  return rows.map(toRef);
}

/**
 * Expenses that could be installment `n`: unlinked, non-adjustment, not a yearly cost, from any
 * account that is not a loan or investment account, within ±₹1 of its EMI and 45 days of its date.
 */
export async function installmentCandidates(userId: bigint, debtId: bigint, n: number): Promise<TransactionRef[]> {
  const debt = await ownedLoan(userId, debtId);
  const row = installment(debt, n);
  const at = dateEpoch(row.date);
  const window = 45 * DAY;
  const rows = await prisma.$queryRaw<
    Array<{ transaction_id: bigint; description: string | null; amount: bigint; date_timestamp: bigint }>
  >`SELECT transactions.transaction_id, transactions.description, transactions.amount, transactions.date_timestamp
    ${ownershipSql(userId)}
      AND transactions.type = ${MYFIN.TRX_TYPES.EXPENSE}
      AND transactions.debt_id IS NULL
      AND transactions.yearly_cost_id IS NULL
      AND transactions.is_adjustment = false
      AND transactions.amount BETWEEN ${row.emi - MATCH_TOLERANCE_CENTS} AND ${row.emi + MATCH_TOLERANCE_CENTS}
      AND transactions.date_timestamp BETWEEN ${at - window} AND ${at + window + DAY}
      AND EXISTS (SELECT 1 FROM accounts src WHERE src.account_id = transactions.accounts_account_from_id
                    AND src.type NOT IN (${Prisma.join(NOT_LOAN_OR_INVEST)}))
    ORDER BY ABS(CAST(transactions.date_timestamp AS SIGNED) - ${at}) ASC, transactions.transaction_id ASC
    LIMIT 50`;
  return rows.map(toRef);
}

async function assertUnpaid(tx: Tx, debtId: bigint, n: number) {
  const paid = await tx.debt_payments.count({ where: { debts_debt_id: debtId, installment_no: n } });
  if (paid > 0) throw APIError.badRequest('This installment is already paid.');
}

/**
 * Matches installment `n` to a real expense within ±₹1 of its EMI: the expense becomes the interest
 * part (category "Loan interest", role interest; its date and description kept) and a principal
 * transfer from the expense's account to the loan account is created, so that account's net change
 * still equals the original debit.
 */
export async function matchInstallment(
  userId: bigint,
  debtId: bigint,
  n: number,
  transactionId: number | string | bigint,
  now: number = nowSeconds()
): Promise<Loan> {
  const trxId = BigInt(transactionId);
  await prisma.$transaction(
    async (tx) => {
      const debt = await lockLoan(userId, debtId, tx);
      if (debt.loan_account_id == null) throw APIError.badRequest('This loan has no loan account.');
      const row = installment(debt, n);
      await assertUnpaid(tx, debtId, n);

      const owned = await tx.$queryRaw<Array<{ transaction_id: bigint }>>`
        SELECT transactions.transaction_id ${ownershipSql(userId)}
          AND transactions.transaction_id = ${trxId} LIMIT 1`;
      if (owned.length === 0) throw APIError.notAuthorized();
      const trx = await tx.transactions.findUniqueOrThrow({ where: { transaction_id: trxId } });
      if (trx.type !== MYFIN.TRX_TYPES.EXPENSE || trx.accounts_account_from_id == null)
        throw APIError.badRequest('Only an expense can be matched to an EMI.');
      if (trx.is_adjustment) throw APIError.badRequest('A balance adjustment cannot be matched to an EMI.');
      const source = await tx.accounts.findUniqueOrThrow({ where: { account_id: trx.accounts_account_from_id } });
      if (NOT_LOAN_OR_INVEST.includes(source.type))
        throw APIError.badRequest('An EMI must be paid from a bank, card or cash account, not a loan or investment account.');
      const original = Number(trx.amount);
      if (Math.abs(original - row.emi) > MATCH_TOLERANCE_CENTS)
        throw APIError.badRequest('The amount must be within ₹1 of the EMI.');

      const principalPart = Math.min(row.principal, original);
      const interestPart = original - principalPart;
      const categoryId = await interestCategory(userId, tx);
      // Conditional: fails if another request linked this row first
      const { count } = await tx.transactions.updateMany({
        where: { transaction_id: trxId, debt_id: null, yearly_cost_id: null },
        data: {
          amount: interestPart,
          categories_category_id: categoryId,
          debt_id: debtId,
          debt_role: 'interest',
        },
      });
      if (count === 0) throw APIError.badRequest('This transaction is already linked to a debt or yearly cost.');

      const principalTrx = await TransactionService.createTransaction(
        userId,
        {
          amount: principalPart / 100,
          type: MYFIN.TRX_TYPES.TRANSFER,
          description: `Loan principal — ${debt.counterparty_name} #${n}`,
          account_from_id: trx.accounts_account_from_id,
          account_to_id: debt.loan_account_id,
          date_timestamp: Number(trx.date_timestamp),
          is_essential: false,
          debt_id: debtId,
          debt_role: 'principal',
        },
        tx as never
      );
      await tx.debt_payments.create({
        data: {
          debts_debt_id: debtId,
          date: trx.date_timestamp,
          amount: original,
          principal_part: principalPart,
          interest_part: interestPart,
          transaction_id: trxId,
          principal_transaction_id: principalTrx.transaction_id,
          installment_no: n,
          manual: false,
          original_amount: original,
          original_category_id: trx.categories_category_id,
        },
      });
      const recalcs: AccountRecalcs = new Map();
      addRecalc(recalcs, trx.accounts_account_from_id, trx.date_timestamp);
      await recalcAccounts(userId, recalcs, tx);
      await refreshDebtStatus(debtId, tx);
    },
    { timeout: 30_000 }
  );
  return getLoan(userId, debtId, now);
}

async function markPaidInTx(userId: bigint, debt: DebtRow, n: number, date: number | undefined, now: number, tx: Tx) {
  if (debt.loan_account_id == null) throw APIError.badRequest('This loan has no loan account.');
  const row = installment(debt, n);
  await assertUnpaid(tx, debt.debt_id, n);
  const paidOn = date ?? Math.min(dateEpoch(row.date), now);
  const adjustment = await TransactionService.createTransaction(
    userId,
    {
      amount: row.principal / 100,
      type: MYFIN.TRX_TYPES.INCOME,
      description: `Loan principal — ${debt.counterparty_name} #${n}`,
      account_to_id: debt.loan_account_id,
      date_timestamp: paidOn,
      is_essential: false,
      is_adjustment: true,
      debt_id: debt.debt_id,
      debt_role: 'principal',
    },
    tx as never
  );
  await tx.debt_payments.create({
    data: {
      debts_debt_id: debt.debt_id,
      date: paidOn,
      amount: row.emi,
      principal_part: row.principal,
      interest_part: row.interest,
      principal_transaction_id: adjustment.transaction_id,
      installment_no: n,
      manual: true,
    },
  });
}

/**
 * Marks installment `n` paid outside MyFin: a payment with `manual = true` and an adjustment income
 * of the principal part on the loan account. The bank is untouched and the interest is not spending.
 */
export async function markInstallmentPaid(
  userId: bigint,
  debtId: bigint,
  n: number,
  input: { date?: number | null },
  now: number = nowSeconds()
): Promise<Loan> {
  await prisma.$transaction(
    async (tx) => {
      const debt = await lockLoan(userId, debtId, tx);
      await markPaidInTx(userId, debt, n, input.date ?? undefined, now, tx);
      await refreshDebtStatus(debtId, tx);
    },
    { timeout: 30_000 }
  );
  return getLoan(userId, debtId, now);
}

/** Marks every unpaid installment dated on or before now as paid manually. */
export async function markPastInstallmentsPaid(
  userId: bigint,
  debtId: bigint,
  now: number = nowSeconds()
): Promise<Loan> {
  await prisma.$transaction(
    async (tx) => {
      const debt = await lockLoan(userId, debtId, tx);
      const paid = new Set(
        (await tx.debt_payments.findMany({ where: { debts_debt_id: debtId }, select: { installment_no: true } })).map(
          (p) => p.installment_no
        )
      );
      for (const row of loanSchedule(debt)) {
        if (paid.has(row.n) || dateEpoch(row.date) > now) continue;
        await markPaidInTx(userId, debt, row.n, undefined, now, tx);
      }
      await refreshDebtStatus(debtId, tx);
    },
    { timeout: 120_000 }
  );
  return getLoan(userId, debtId, now);
}

/** Reverses a match (original amount and category back, principal transfer deleted) or a manual payment. */
export async function unpayInstallment(
  userId: bigint,
  debtId: bigint,
  n: number,
  now: number = nowSeconds()
): Promise<Loan> {
  await prisma.$transaction(
    async (tx) => {
      await lockLoan(userId, debtId, tx);
      const payment = await tx.debt_payments.findFirst({ where: { debts_debt_id: debtId, installment_no: n } });
      if (!payment) throw APIError.badRequest('This installment is not paid.');
      await recalcAccounts(userId, await undoLoanPayment(payment, tx), tx);
      await refreshDebtStatus(debtId, tx);
    },
    { timeout: 30_000 }
  );
  return getLoan(userId, debtId, now);
}

/**
 * Unlinked, non-adjustment expenses from the paying account within ±₹1 of an unpaid installment's
 * EMI and within 10 days of its date; each expense is suggested for at most one installment
 * (the nearest by date, earliest installment first).
 */
export async function matchSuggestions(
  userId: bigint,
  debtId: bigint,
  now: number = nowSeconds()
): Promise<MatchSuggestion[]> {
  const debt = await ownedLoan(userId, debtId);
  if (debt.account_id == null) return [];
  const loan = (await loansDto([debt], now))[0];
  const unpaid = loanSchedule(debt).filter((r) => loan.schedule[r.n - 1].status !== 'paid');
  if (unpaid.length === 0) return [];
  const window = SUGGESTION_WINDOW_DAYS * DAY;
  const from = dateEpoch(unpaid[0].date) - window;
  const to = dateEpoch(unpaid[unpaid.length - 1].date) + window + DAY;
  const amounts = unpaid.map((r) => r.emi);
  const lo = Math.min(...amounts) - MATCH_TOLERANCE_CENTS;
  const hi = Math.max(...amounts) + MATCH_TOLERANCE_CENTS;
  const candidates = await prisma.$queryRaw<
    Array<{ transaction_id: bigint; description: string | null; amount: bigint; date_timestamp: bigint }>
  >`SELECT transactions.transaction_id, transactions.description, transactions.amount, transactions.date_timestamp
    ${ownershipSql(userId)}
      AND transactions.type = ${MYFIN.TRX_TYPES.EXPENSE}
      AND transactions.accounts_account_from_id = ${debt.account_id}
      AND transactions.debt_id IS NULL
      AND transactions.yearly_cost_id IS NULL
      AND transactions.is_adjustment = false
      AND transactions.amount BETWEEN ${lo} AND ${hi}
      AND transactions.date_timestamp BETWEEN ${from} AND ${to}
    ORDER BY transactions.date_timestamp ASC, transactions.transaction_id ASC
    LIMIT 200`;
  const used = new Set<string>();
  const out: MatchSuggestion[] = [];
  for (const r of unpaid) {
    const at = dateEpoch(r.date);
    let best: (typeof candidates)[number] | null = null;
    for (const c of candidates) {
      if (used.has(String(c.transaction_id))) continue;
      if (Math.abs(Number(c.amount) - r.emi) > MATCH_TOLERANCE_CENTS) continue;
      const gap = Math.abs(Number(c.date_timestamp) - at);
      if (gap > window + DAY) continue;
      if (!best || gap < Math.abs(Number(best.date_timestamp) - at)) best = c;
    }
    if (best) {
      used.add(String(best.transaction_id));
      out.push({
        n: r.n,
        transaction_id: best.transaction_id.toString(),
        description: best.description ?? '',
        amount: currency(best.amount),
        date: Number(best.date_timestamp),
      });
    }
  }
  return out;
}

/** What paying `amount` (currency) extra after installment `afterInstallment` would save. */
export async function prepayment(
  userId: bigint,
  debtId: bigint,
  amount: number,
  afterInstallment: number
): Promise<{ months_saved: number; interest_saved: number; new_end_date: string }> {
  const debt = await ownedLoan(userId, debtId);
  if (!(amount > 0)) throw APIError.badRequest('amount must be positive.');
  const rows = loanSchedule(debt);
  if (!Number.isInteger(afterInstallment) || afterInstallment < 0 || afterInstallment > rows.length)
    throw APIError.badRequest('after_installment is out of range.');
  const r = prepaymentWhatIf(rows, afterInstallment, cents(amount), Number(debt.rate));
  return { ...r, interest_saved: currency(r.interest_saved) };
}

/**
 * Ruling D3, in one transaction: matched debits get their original amount and category back and
 * are unlinked; principal transfers and the loan's adjustment rows are deleted; a disbursement is
 * unlinked; the loan and its LOANAC account are deleted.
 */
export async function deleteLoan(userId: bigint, debtId: bigint): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const debt = await lockLoan(userId, debtId, tx);
      const recalcs: AccountRecalcs = new Map();
      const payments = await tx.debt_payments.findMany({ where: { debts_debt_id: debtId } });
      for (const p of payments)
        for (const r of (await undoLoanPayment(p, tx)).values()) addRecalc(recalcs, r.accountId, r.from);

      // Whatever else the loan created (the opening adjustment, any orphaned principal rows)
      const leftovers = await tx.transactions.findMany({ where: { debt_id: debtId, debt_role: 'principal' } });
      for (const t of leftovers) {
        addRecalc(recalcs, t.accounts_account_from_id, t.date_timestamp);
        addRecalc(recalcs, t.accounts_account_to_id, t.date_timestamp);
      }
      const leftoverIds = leftovers.map((t) => t.transaction_id);
      if (leftoverIds.length > 0) {
        await tx.transaction_has_tags.deleteMany({ where: { transactions_transaction_id: { in: leftoverIds } } });
        await tx.transactions.deleteMany({ where: { transaction_id: { in: leftoverIds } } });
      }
      await tx.transactions.updateMany({ where: { debt_id: debtId }, data: { debt_id: null, debt_role: null } });
      await tx.debts.delete({ where: { debt_id: debtId } });

      const loanAccountId = debt.loan_account_id;
      if (loanAccountId != null) {
        // Every loan-made row is gone by now; anything left was added by hand
        const [others, planned, goals] = await Promise.all([
          tx.transactions.count({
            where: { OR: [{ accounts_account_from_id: loanAccountId }, { accounts_account_to_id: loanAccountId }] },
          }),
          tx.planned_transactions.count({
            where: { OR: [{ accounts_account_from_id: loanAccountId }, { accounts_account_to_id: loanAccountId }] },
          }),
          tx.goal_has_account.count({ where: { accounts_account_id: loanAccountId } }),
        ]);
        if (others + planned + goals > 0)
          throw APIError.badRequest(
            'The loan account has other transactions, plans or goals. Move or delete them first.'
          );
        await tx.balances_snapshot.deleteMany({ where: { accounts_account_id: loanAccountId } });
        await tx.balance_checks.deleteMany({ where: { accounts_account_id: loanAccountId } });
        await tx.accounts.delete({ where: { account_id: loanAccountId } });
      }
      await recalcAccounts(userId, recalcs, tx, loanAccountId != null ? [loanAccountId] : []);
    },
    { timeout: 60_000 }
  );
}

export default {
  loanSchedule,
  getLoan,
  listLoans,
  createLoan,
  matchInstallment,
  markInstallmentPaid,
  markPastInstallmentsPaid,
  unpayInstallment,
  matchSuggestions,
  prepayment,
  deleteLoan,
  linkDisbursement,
  unlinkDisbursement,
  disbursementCandidates,
  installmentCandidates,
};
