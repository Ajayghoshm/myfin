import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import { MYFIN } from '../../consts.js';
import APIError from '../../errorHandling/apiError.js';
import ConvertUtils from '../../utils/convertUtils.js';
import { getFinancialProfile } from '../financialProfileService.js';
import {
  IST_OFFSET_SECONDS,
  type YearMonth,
  monthRangeIST,
  payeeKeySql,
  shiftMonth,
} from '../insights/insightsPrimitives.js';

/** ₹5,000 in cents. */
const SUGGESTION_MIN_CENTS = 500_000;
const WINDOW_MONTHS = 13;
const QUIET_MONTHS = 10;
const UPCOMING_MONTHS = 2;

export type YearlyCost = {
  yearly_cost_id: string;
  name: string;
  amount: number;
  due_month: number;
  category_id: string | null;
  category_name: string | null;
  active: boolean;
  linked_count: number;
};

export type YearlyCostInput = {
  name: string;
  amount: number;
  due_month: number;
  category_id?: number | string | bigint | null;
  active?: boolean;
  /** Link this expense transaction to the new cost (accepting a suggestion). */
  link_transaction_id?: number | string | bigint | null;
};

export type SinkingStatus = {
  account: { account_id: string; name: string; balance: number } | null;
  monthly_total: number;
  should_have: number;
  behind_by: number;
  catch_up_this_month: number;
  on_track: boolean;
  upcoming: { yearly_cost_id: string; name: string; amount: number; due_month: number }[];
};

export type Suggestion = {
  transaction_id: string;
  payee_key: string;
  description: string;
  amount: number;
  date: number;
  category_id: string | null;
  suggested_due_month: number;
};

export type Candidate = {
  transaction_id: string;
  payee_key: string;
  description: string;
  amount: number;
  date: number;
  category_id: string | null;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

const monthOf = (epoch: number): YearMonth => {
  const d = new Date((epoch + IST_OFFSET_SECONDS) * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
};

const cents = (currency: number) => ConvertUtils.convertFloatToBigInteger(currency);
const idStr = (v: bigint | null | undefined) => (v == null ? null : v.toString());

function assertDueMonth(m: number) {
  if (!Number.isInteger(m) || m < 1 || m > 12) throw APIError.badRequest('due_month must be between 1 and 12.');
}

async function assertCategory(userId: bigint, categoryId: bigint | null) {
  if (categoryId == null) return;
  const cat = await prisma.categories.findFirst({
    where: { category_id: categoryId, users_user_id: userId },
    select: { category_id: true },
  });
  if (!cat) throw APIError.badRequest('Category does not belong to this user.');
}

async function ownedCost(userId: bigint, id: bigint) {
  const cost = await prisma.yearly_costs.findFirst({ where: { yearly_cost_id: id, users_user_id: userId } });
  if (!cost) throw APIError.notAuthorized();
  return cost;
}

const toBigOrNull = (v: number | string | bigint | null | undefined) => (v == null ? null : BigInt(v));

async function toDto(userId: bigint, rows: Prisma.yearly_costsGetPayload<object>[]): Promise<YearlyCost[]> {
  const catIds = [...new Set(rows.map((r) => r.category_id).filter((c): c is bigint => c != null))];
  const cats = catIds.length
    ? await prisma.categories.findMany({
        where: { category_id: { in: catIds }, users_user_id: userId },
        select: { category_id: true, name: true },
      })
    : [];
  const catName = new Map(cats.map((c) => [c.category_id.toString(), c.name]));
  const counts = await prisma.transactions.groupBy({
    by: ['yearly_cost_id'],
    where: { yearly_cost_id: { in: rows.map((r) => r.yearly_cost_id) } },
    _count: { _all: true },
  });
  const linked = new Map(counts.map((c) => [String(c.yearly_cost_id), c._count._all]));
  return rows.map((r) => ({
    yearly_cost_id: r.yearly_cost_id.toString(),
    name: r.name,
    amount: ConvertUtils.convertBigIntegerToFloat(r.amount),
    due_month: r.due_month,
    category_id: idStr(r.category_id),
    category_name: r.category_id == null ? null : (catName.get(r.category_id.toString()) ?? null),
    active: r.active,
    linked_count: linked.get(r.yearly_cost_id.toString()) ?? 0,
  }));
}

export async function listYearlyCosts(userId: bigint): Promise<YearlyCost[]> {
  const rows = await prisma.yearly_costs.findMany({
    where: { users_user_id: userId },
    orderBy: [{ name: 'asc' }, { yearly_cost_id: 'asc' }],
  });
  return toDto(userId, rows);
}

/** The user's own expense transaction; throws 401 / 400 otherwise. */
async function assertLinkable(userId: bigint, transactionId: bigint, linking = true) {
  const trx = await prisma.transactions.findFirst({
    where: {
      transaction_id: transactionId,
      OR: [
        { accounts_transactions_accounts_account_from_idToaccounts: { users_user_id: userId } },
        { accounts_transactions_accounts_account_to_idToaccounts: { users_user_id: userId } },
      ],
    },
    select: { type: true, debt_id: true },
  });
  if (!trx) throw APIError.notAuthorized();
  if (trx.type !== MYFIN.TRX_TYPES.EXPENSE) throw APIError.badRequest('Only expense transactions can be linked.');
  // A row is either a yearly cost or a debt, never both
  if (linking && trx.debt_id != null)
    throw APIError.badRequest('This transaction is linked to a debt. Unlink it from the debt first.');
}

export async function createYearlyCost(
  userId: bigint,
  input: YearlyCostInput,
  now: number = nowSeconds()
): Promise<YearlyCost> {
  assertDueMonth(input.due_month);
  const categoryId = toBigOrNull(input.category_id);
  await assertCategory(userId, categoryId);
  const linkId = toBigOrNull(input.link_transaction_id);
  if (linkId != null) await assertLinkable(userId, linkId);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.yearly_costs.create({
      data: {
        users_user_id: userId,
        name: input.name,
        amount: cents(input.amount),
        due_month: input.due_month,
        category_id: categoryId,
        active: input.active ?? true,
        created_at: now,
      },
    });
    if (linkId != null)
      await tx.transactions.update({
        where: { transaction_id: linkId },
        data: { yearly_cost_id: created.yearly_cost_id },
      });
    return created;
  });
  return (await toDto(userId, [row]))[0];
}

export async function updateYearlyCost(userId: bigint, id: bigint, input: YearlyCostInput): Promise<YearlyCost> {
  await ownedCost(userId, id);
  assertDueMonth(input.due_month);
  const categoryId = toBigOrNull(input.category_id);
  await assertCategory(userId, categoryId);
  const row = await prisma.yearly_costs.update({
    where: { yearly_cost_id: id },
    data: {
      name: input.name,
      amount: cents(input.amount),
      due_month: input.due_month,
      category_id: categoryId,
      ...(input.active === undefined ? {} : { active: input.active }),
    },
  });
  return (await toDto(userId, [row]))[0];
}

/** Linked transactions are unlinked by the FK's ON DELETE SET NULL. */
export async function deleteYearlyCost(userId: bigint, id: bigint): Promise<void> {
  await ownedCost(userId, id);
  await prisma.yearly_costs.delete({ where: { yearly_cost_id: id } });
}

/** Sinking account if set, still the user's, otherwise null. */
async function sinkingAccount(userId: bigint) {
  const profile = await getFinancialProfile(userId);
  if (profile.sinking_fund_account_id == null) return null;
  return prisma.accounts.findFirst({
    where: {
      account_id: BigInt(profile.sinking_fund_account_id),
      users_user_id: userId,
      status: MYFIN.ACCOUNT_STATUS.ACTIVE,
    },
    select: { account_id: true, name: true, current_balance: true },
  });
}

/** Σ active yearly amounts / 12, in cents, rounded. */
export async function yearlySetasideMonthlyCents(userId: bigint): Promise<number> {
  const rows = await prisma.yearly_costs.findMany({
    where: { users_user_id: userId, active: true },
    select: { amount: true },
  });
  return Math.round(rows.reduce((s, r) => s + Number(r.amount), 0) / 12);
}

export async function sinkingStatus(userId: bigint, now: number = nowSeconds()): Promise<SinkingStatus> {
  const current = monthOf(now).month;
  const costs = await prisma.yearly_costs.findMany({
    where: { users_user_id: userId, active: true },
    orderBy: [{ due_month: 'asc' }, { yearly_cost_id: 'asc' }],
  });
  const account = await sinkingAccount(userId);
  const monthlyTotal = await yearlySetasideMonthlyCents(userId);
  const shouldHave = Math.round(
    costs.reduce((s, c) => s + (Number(c.amount) * ((current - c.due_month + 12) % 12)) / 12, 0)
  );
  const balance = account ? Number(account.current_balance) : 0;
  const behind = account ? Math.max(0, shouldHave - balance) : Math.max(0, shouldHave);
  const upcoming = costs
    .filter((c) => (c.due_month - current + 12) % 12 <= UPCOMING_MONTHS)
    .sort((a, b) => ((a.due_month - current + 12) % 12) - ((b.due_month - current + 12) % 12))
    .map((c) => ({
      yearly_cost_id: c.yearly_cost_id.toString(),
      name: c.name,
      amount: ConvertUtils.convertBigIntegerToFloat(c.amount),
      due_month: c.due_month,
    }));
  return {
    account: account
      ? {
          account_id: account.account_id.toString(),
          name: account.name,
          balance: balance / 100,
        }
      : null,
    monthly_total: monthlyTotal / 100,
    should_have: shouldHave / 100,
    behind_by: behind / 100,
    catch_up_this_month: (behind + monthlyTotal) / 100,
    on_track: account != null && behind === 0,
    upcoming,
  };
}

type ExpenseRow = {
  transaction_id: bigint;
  description: string | null;
  amount: bigint;
  date_timestamp: bigint;
  category_id: bigint | null;
  yearly_cost_id: bigint | null;
  payee_key: string | null;
};

/** The user's counted expense rows from `from` (epoch seconds) on. */
async function expenseRows(userId: bigint, from: number): Promise<ExpenseRow[]> {
  return prisma.$queryRaw<ExpenseRow[]>`
    SELECT transactions.transaction_id,
           transactions.description,
           transactions.amount,
           transactions.date_timestamp,
           transactions.categories_category_id AS category_id,
           transactions.yearly_cost_id,
           ${payeeKeySql} AS payee_key
    FROM transactions
      LEFT JOIN accounts acc_from ON acc_from.account_id = transactions.accounts_account_from_id
    WHERE acc_from.users_user_id = ${userId}
      AND transactions.type = ${MYFIN.TRX_TYPES.EXPENSE}
      AND transactions.is_adjustment = false
      AND transactions.debt_id IS NULL
      AND transactions.date_timestamp >= ${from}`;
}

const windowStart = (now: number) => monthRangeIST(shiftMonth(monthOf(now), -(WINDOW_MONTHS - 1))).from;

export async function suggestions(userId: bigint, now: number = nowSeconds()): Promise<Suggestion[]> {
  const start = windowStart(now);
  const rows = await expenseRows(userId, monthRangeIST(shiftMonth(monthOf(now), -(WINDOW_MONTHS - 1 + QUIET_MONTHS))).from);
  const dismissed = new Set(
    (await prisma.yearly_cost_dismissals.findMany({ where: { users_user_id: userId } })).map((d) => d.payee_key)
  );
  const byKey = new Map<string, ExpenseRow[]>();
  for (const r of rows) {
    const k = r.payee_key ?? '';
    if (!k) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const out: Suggestion[] = [];
  for (const [key, list] of byKey) {
    if (dismissed.has(key)) continue;
    const qualifying = list
      .filter((r) => {
        const date = Number(r.date_timestamp);
        if (date < start || r.yearly_cost_id != null || Number(r.amount) < SUGGESTION_MIN_CENTS) return false;
        const quietFrom = monthRangeIST(shiftMonth(monthOf(date), -QUIET_MONTHS)).from;
        const quietTo = monthRangeIST(shiftMonth(monthOf(date), QUIET_MONTHS)).to;
        return !list.some((o) => {
          const od = Number(o.date_timestamp);
          return o.transaction_id !== r.transaction_id && od >= quietFrom && od < quietTo;
        });
      })
      .sort((a, b) => Number(b.date_timestamp) - Number(a.date_timestamp));
    const r = qualifying[0];
    if (!r) continue;
    out.push({
      transaction_id: r.transaction_id.toString(),
      payee_key: key,
      description: r.description ?? '',
      amount: ConvertUtils.convertBigIntegerToFloat(r.amount),
      date: Number(r.date_timestamp),
      category_id: idStr(r.category_id),
      suggested_due_month: monthOf(Number(r.date_timestamp)).month,
    });
  }
  return out.sort((a, b) => b.date - a.date || a.payee_key.localeCompare(b.payee_key));
}

export async function dismissSuggestion(userId: bigint, payeeKey: string): Promise<void> {
  await prisma.yearly_cost_dismissals.createMany({
    data: [{ users_user_id: userId, payee_key: payeeKey }],
    skipDuplicates: true,
  });
}

/** Link (or, with null, unlink) one of the user's expense transactions to one of their yearly costs. */
export async function linkTransaction(
  userId: bigint,
  transactionId: bigint,
  yearlyCostId: bigint | null
): Promise<void> {
  await assertLinkable(userId, transactionId, yearlyCostId != null);
  if (yearlyCostId != null) await ownedCost(userId, yearlyCostId);
  await prisma.transactions.update({
    where: { transaction_id: transactionId },
    data: { yearly_cost_id: yearlyCostId },
  });
}

export async function candidates(userId: bigint, yearlyCostId: bigint, now: number = nowSeconds()): Promise<Candidate[]> {
  const cost = await ownedCost(userId, yearlyCostId);
  const start = windowStart(now);
  const rows = await expenseRows(userId, start);
  const linkedKeys = new Set(
    (
      await prisma.$queryRaw<{ payee_key: string | null }[]>`
        SELECT DISTINCT ${payeeKeySql} AS payee_key
        FROM transactions
        WHERE transactions.yearly_cost_id = ${yearlyCostId}`
    ).map((r) => r.payee_key ?? '')
  );
  linkedKeys.delete('');
  return rows
    .filter(
      (r) =>
        r.yearly_cost_id == null &&
        ((cost.category_id != null && r.category_id === cost.category_id) || linkedKeys.has(r.payee_key ?? ''))
    )
    .sort((a, b) => Number(b.date_timestamp) - Number(a.date_timestamp) || Number(b.transaction_id - a.transaction_id))
    .map((r) => ({
      transaction_id: r.transaction_id.toString(),
      payee_key: r.payee_key ?? '',
      description: r.description ?? '',
      amount: ConvertUtils.convertBigIntegerToFloat(r.amount),
      date: Number(r.date_timestamp),
      category_id: idStr(r.category_id),
    }));
}

export default {
  listYearlyCosts,
  createYearlyCost,
  updateYearlyCost,
  deleteYearlyCost,
  sinkingStatus,
  yearlySetasideMonthlyCents,
  suggestions,
  dismissSuggestion,
  linkTransaction,
  candidates,
};
