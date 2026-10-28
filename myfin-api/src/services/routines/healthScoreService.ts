import { prisma } from '../../config/prisma.js';
import { MYFIN } from '../../consts.js';
import { listAccountsWithFreshness } from '../accountFreshnessService.js';
import { listLoans } from '../debts/loanService.js';
import { getFinancialProfile } from '../financialProfileService.js';
import { formatYearMonth, targetPercent } from '../insights/analyticsRules.js';
import { type YearMonth, monthRangeIST, shiftMonth } from '../insights/insightsPrimitives.js';
import { getMonthInsights } from '../insights/insightsService.js';
import { ownershipSql, typicalMonth } from '../insights/typicalMonth.js';
import { emergencyFund } from '../planning/emergencyFundService.js';
import { sinkingStatus } from '../planning/yearlyCostService.js';
import { balancesAt } from '../wealth/netWorthService.js';
import {
  GRACE_DAYS,
  freezeAfterGrace,
  getOrFreeze,
  graceEnd,
  isPastMonth,
  monthKey,
  monthOfIST,
} from './monthlyRecordService.js';

export type CheckStatus = 'pass' | 'fail' | 'not_set_up';
export type HealthCheckKey =
  | 'savings_rate'
  | 'emergency_fund'
  | 'yearly_costs'
  | 'fixed_costs'
  | 'credit_cards'
  | 'debt_emis'
  | 'data';
export type TextParams = Record<string, string | number>;
export type HealthCheck = {
  key: HealthCheckKey;
  status: CheckStatus;
  /** Short English figure (fallback); `value_key` + `value_params` localise it. */
  value: string | null;
  value_key: string | null;
  value_params: TextParams;
  /** English hint naming the threshold (fallback); `hint_key` + `hint_params` localise it. */
  hint: string;
  hint_key: string;
  hint_params: TextParams;
  link: string;
};
export type HealthScore = {
  month: string;
  passed: number;
  /** Checks that pass or fail; not_set_up is excluded. */
  total: number;
  checks: HealthCheck[];
};
export type StoredHealth = HealthScore & { frozen: boolean };

/** Fixed costs at most this share of typical income. */
export const FIXED_SHARE_MAX = 0.5;
/** Open loans' EMIs at most this share of typical income. */
export const EMI_SHARE_MAX = 0.4;
/** A card balance must be cleared by transfers within this many days. */
export const CARD_CLEAR_DAYS = 35;
/** Tolerance when comparing card payments to the balance (₹1). */
const CARD_TOLERANCE_CENTS = 100;
const HISTORY_MONTHS = 12;
const DAY = 86_400;

const KEYS: HealthCheckKey[] = [
  'savings_rate',
  'emergency_fund',
  'yearly_costs',
  'fixed_costs',
  'credit_cards',
  'debt_emis',
  'data',
];

const LINKS: Record<HealthCheckKey, string> = {
  savings_rate: '/profile',
  emergency_fund: '/accounts',
  yearly_costs: '/yearly-costs',
  fixed_costs: '/categories',
  credit_cards: '/accounts/balance-check',
  debt_emis: '/debts',
  data: '/accounts',
};

const nowSeconds = () => Math.floor(Date.now() / 1000);
const pctNum = (share: number) => Math.round(share * 100);
const money = (currency: number) => Math.round(currency).toLocaleString('en-IN');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Text = { key: string; params: TextParams; text: string };
const txt = (key: string, text: string, params: TextParams = {}): Text => ({ key, params, text });

const check = (key: HealthCheckKey, status: CheckStatus, value: Text | null, hint: Text): HealthCheck => ({
  key,
  status,
  value: value?.text ?? null,
  value_key: value?.key ?? null,
  value_params: value?.params ?? {},
  hint: hint.text,
  hint_key: hint.key,
  hint_params: hint.params,
  link: LINKS[key],
});

const NO_TYPICAL_INCOME = txt('no_typical_income', 'Not enough income history yet for a typical month');
const shareOfIncome = (share: number) =>
  txt('share_of_income', `${pctNum(share)} % of income`, { pct: pctNum(share) });

type Ctx = { userId: bigint; ym: YearMonth; range: { from: number; to: number }; now: number; stateNow: number };

async function savingsRateCheck(c: Ctx, typicalIncomeCents: number | null): Promise<HealthCheck> {
  const [profile, insights] = await Promise.all([getFinancialProfile(c.userId), getMonthInsights(c.userId, c.ym)]);
  if (!profile.savings_target_value)
    return check('savings_rate', 'not_set_up', null, txt('savings_no_target', 'Set a savings target in your profile'));
  const income = insights.summary.income;
  const typicalIncome = typicalIncomeCents != null && typicalIncomeCents > 0 ? typicalIncomeCents / 100 : null;
  const target = targetPercent(profile.savings_target_mode, profile.savings_target_value, income, typicalIncome);
  if (target == null || (income <= 0 && typicalIncome == null))
    return check(
      'savings_rate',
      'not_set_up',
      null,
      txt('savings_no_income_base', 'No income recorded yet to measure your savings target against')
    );
  const aim = Math.round(target);
  const rate = insights.summary.savings_rate;
  if (rate == null)
    return check(
      'savings_rate',
      'fail',
      null,
      txt('savings_no_income_month', `No income this month (aim ≥ ${aim} %)`, { target: aim })
    );
  const status = rate * 100 + 1e-9 >= target ? 'pass' : 'fail';
  const r = pctNum(rate);
  return check(
    'savings_rate',
    status,
    txt('percent', `${r} %`, { pct: r }),
    txt('savings_rate', `Savings rate is ${r} % (aim ≥ ${aim} %)`, { rate: r, target: aim })
  );
}

async function emergencyFundCheck(c: Ctx): Promise<HealthCheck> {
  const ef = await emergencyFund(c.userId, c.stateNow);
  if (ef.status === 'no_accounts')
    return check('emergency_fund', 'not_set_up', null, txt('ef_no_accounts', 'Tick the accounts that hold your emergency fund'));
  if (ef.status === 'no_fixed' || ef.months_covered == null)
    return check(
      'emergency_fund',
      'not_set_up',
      null,
      txt('ef_no_fixed', 'Mark your fixed-cost categories so the fund can be measured')
    );
  const months = ef.months_covered.toFixed(1);
  const target = ef.target_months;
  return check(
    'emergency_fund',
    ef.months_covered >= target ? 'pass' : 'fail',
    txt('months_of', `${months} of ${target} months`, { months, target }),
    txt('ef_months', `Emergency fund covers ${months} months of fixed costs (aim ≥ ${target})`, { months, target })
  );
}

async function yearlyCostsCheck(c: Ctx): Promise<HealthCheck> {
  const active = await prisma.yearly_costs.count({ where: { users_user_id: c.userId, active: true } });
  if (active === 0) return check('yearly_costs', 'not_set_up', null, txt('yearly_none', 'Add your yearly costs'));
  const s = await sinkingStatus(c.userId, c.stateNow);
  if (s.account == null)
    return check('yearly_costs', 'not_set_up', null, txt('yearly_no_account', 'Choose a sinking-fund account for yearly costs'));
  if (s.on_track)
    return check(
      'yearly_costs',
      'pass',
      txt('on_track', 'on track'),
      txt('yearly_on_track', 'The sinking fund is on track for your yearly costs')
    );
  return check(
    'yearly_costs',
    'fail',
    txt('behind', `behind by ${money(s.behind_by)}`, { amount: s.behind_by }),
    txt('yearly_behind', `The sinking fund is behind by ${money(s.behind_by)} (aim: on track)`, { amount: s.behind_by })
  );
}

async function fixedCostsCheck(c: Ctx, typical: { incomeCents: number | null; fixedCents: number | null }): Promise<HealthCheck> {
  const fixedCats = await prisma.categories.count({ where: { users_user_id: c.userId, is_fixed: true } });
  if (fixedCats === 0) return check('fixed_costs', 'not_set_up', null, txt('fixed_no_categories', 'Mark your fixed-cost categories'));
  if (typical.incomeCents == null || typical.incomeCents <= 0) return check('fixed_costs', 'not_set_up', null, NO_TYPICAL_INCOME);
  const share = (typical.fixedCents ?? 0) / typical.incomeCents;
  const p = pctNum(share);
  const max = pctNum(FIXED_SHARE_MAX);
  return check(
    'fixed_costs',
    share <= FIXED_SHARE_MAX + 1e-9 ? 'pass' : 'fail',
    shareOfIncome(share),
    txt('fixed_share', `Fixed costs are ${p} % of income (aim ≤ ${max} %)`, { pct: p, max })
  );
}

/** Open loans (loanService) that started before the end of M; their scheduled EMI. */
async function debtEmisCheck(c: Ctx, typicalIncomeCents: number | null): Promise<HealthCheck> {
  const loans = (await listLoans(c.userId, c.now)).filter((l) => l.status === 'open' && l.start_date < c.range.to);
  if (loans.length === 0) return check('debt_emis', 'not_set_up', null, txt('debt_no_loans', 'No open loans to check'));
  if (typicalIncomeCents == null || typicalIncomeCents <= 0) return check('debt_emis', 'not_set_up', null, NO_TYPICAL_INCOME);
  const emiCents = loans.reduce((s, l) => s + Math.round(l.emi * 100), 0);
  const share = emiCents / typicalIncomeCents;
  const p = pctNum(share);
  const max = pctNum(EMI_SHARE_MAX);
  return check(
    'debt_emis',
    share <= EMI_SHARE_MAX + 1e-9 ? 'pass' : 'fail',
    shareOfIncome(share),
    txt('debt_share', `Loan EMIs are ${p} % of income (aim ≤ ${max} %)`, { pct: p, max })
  );
}

/**
 * Each active card's reference balance: its latest balance check dated in M (the real balance), else
 * its balance at the end of M−1. A negative balance is cleared when transfers into the card within
 * 35 days after the reference time cover it (less ₹1). The 35-day window is judged against the real
 * `now`, because it runs past the end of M. Any card failed → fail; else any window still running →
 * not set up; else pass.
 */
async function creditCardsCheck(c: Ctx): Promise<HealthCheck> {
  const cards = await prisma.accounts.findMany({
    where: { users_user_id: c.userId, type: MYFIN.ACCOUNT_TYPES.CREDIT, status: MYFIN.ACCOUNT_STATUS.ACTIVE },
    select: { account_id: true },
    orderBy: { account_id: 'asc' },
  });
  if (cards.length === 0) return check('credit_cards', 'not_set_up', null, txt('cards_none', 'Add your credit-card accounts'));

  const refs: { id: bigint; at: number; cents: number | null }[] = [];
  for (const card of cards) {
    const last = await prisma.balance_checks.findFirst({
      where: { accounts_account_id: card.account_id, checked_at: { gte: c.range.from, lt: c.range.to } },
      orderBy: [{ checked_at: 'desc' }, { check_id: 'desc' }],
    });
    refs.push(
      last
        ? { id: card.account_id, at: Number(last.checked_at), cents: Number(last.real_balance) }
        : { id: card.account_id, at: c.range.from, cents: null }
    );
  }
  const noCheck = refs.filter((r) => r.cents == null).map((r) => r.id);
  const atStart = await balancesAt(noCheck, [c.range.from]);
  for (const r of refs) if (r.cents == null) r.cents = atStart.get(r.id.toString())?.[0] ?? 0;

  let failed = 0;
  let pending = 0;
  for (const r of refs) {
    const owed = -(r.cents ?? 0);
    if (owed <= 0) continue;
    const until = r.at + CARD_CLEAR_DAYS * DAY;
    const paid = await prisma.transactions.aggregate({
      where: { accounts_account_to_id: r.id, type: MYFIN.TRX_TYPES.TRANSFER, date_timestamp: { gte: r.at, lt: until } },
      _sum: { amount: true },
    });
    if (Number(paid._sum.amount ?? 0n) >= owed - CARD_TOLERANCE_CENTS) continue;
    if (c.now >= until) failed++;
    else pending++;
  }
  const days = CARD_CLEAR_DAYS;
  if (failed > 0)
    return check(
      'credit_cards',
      'fail',
      txt('cards_unpaid', `${plural(failed, 'card', 'cards')} not paid in full`, { count: failed }),
      txt(
        'cards_failed',
        `${plural(failed, 'card was', 'cards were')} not paid in full within ${days} days (aim: pay the full balance)`,
        { count: failed, days }
      )
    );
  if (pending > 0)
    return check(
      'credit_cards',
      'not_set_up',
      null,
      txt('cards_pending', `Card payments are still within the ${days}-day window`, { days })
    );
  return check(
    'credit_cards',
    'pass',
    txt('paid_in_full', 'paid in full'),
    txt('cards_paid', `Card balances were paid in full within ${days} days`, { days })
  );
}

/**
 * No active freshness-enabled account is stale (as of `stateNow`), and each has a balance check
 * dated in M or within the first 10 days of M+1. A missing check fails only once that grace period
 * has passed (judged against the real `now`); until then it is pending.
 */
async function dataCheck(c: Ctx): Promise<HealthCheck> {
  const accounts = await listAccountsWithFreshness(c.userId, c.stateNow);
  const enabled = accounts.filter(
    (a) => a.status === MYFIN.ACCOUNT_STATUS.ACTIVE && a.stale_after_days_effective != null
  );
  if (enabled.length === 0)
    return check('data', 'not_set_up', null, txt('data_not_enabled', 'Turn on freshness tracking for your accounts'));

  const stale = enabled.filter((a) => a.freshness === 'stale').length;
  const deadline = graceEnd(c.ym);
  const checked = await prisma.balance_checks.groupBy({
    by: ['accounts_account_id'],
    where: {
      accounts_account_id: { in: enabled.map((a) => a.account_id) },
      checked_at: { gte: c.range.from, lt: deadline },
    },
  });
  const checkedIds = new Set(checked.map((r) => r.accounts_account_id.toString()));
  const unchecked = enabled.filter((a) => !checkedIds.has(a.account_id.toString())).length;
  const day = GRACE_DAYS;

  if (stale > 0)
    return check(
      'data',
      'fail',
      txt('stale', plural(stale, 'stale account', 'stale accounts'), { count: stale }),
      txt('data_stale', `${plural(stale, 'account is', 'accounts are')} stale; import their transactions (aim: none stale)`, {
        count: stale,
      })
    );
  if (unchecked > 0 && c.now >= deadline)
    return check(
      'data',
      'fail',
      txt('unchecked', `${plural(unchecked, 'account', 'accounts')} not checked`, { count: unchecked }),
      txt(
        'data_unchecked',
        `${plural(unchecked, 'account has', 'accounts have')} no balance check for this month (aim: check by day ${day} of next month)`,
        { count: unchecked, day }
      )
    );
  const upToDate = txt('up_to_date', 'up to date');
  if (unchecked > 0)
    return check(
      'data',
      'pass',
      upToDate,
      txt('data_ok_pending', `Accounts are up to date; check balances by day ${day} of next month`, { day })
    );
  return check('data', 'pass', upToDate, txt('data_ok', 'Accounts are up to date and balances checked'));
}

/**
 * The health checklist for month `ym`. For a past month, the checks that read "current" state
 * (emergency fund, sinking fund, staleness) are evaluated with `now` = the last second of the month;
 * those services still read today's account balances. The card window and the balance-check grace
 * period are judged against the real `now`.
 */
export async function healthScore(userId: bigint, ym: YearMonth, now: number = nowSeconds()): Promise<HealthScore> {
  const range = monthRangeIST(ym);
  const stateNow = isPastMonth(ym, now) ? range.to - 1 : now;
  const c: Ctx = { userId, ym, range, now, stateNow };
  const typical = await typicalMonth(userId, ym);
  const checks = [
    await savingsRateCheck(c, typical.incomeCents),
    await emergencyFundCheck(c),
    await yearlyCostsCheck(c),
    await fixedCostsCheck(c, typical),
    await creditCardsCheck(c),
    await debtEmisCheck(c, typical.incomeCents),
    await dataCheck(c),
  ];
  return {
    month: formatYearMonth(ym),
    passed: checks.filter((k) => k.status === 'pass').length,
    total: checks.filter((k) => k.status !== 'not_set_up').length,
    checks,
  };
}

/** Earliest of the user's first transaction and first account creation; null = no data at all. */
async function dataStart(userId: bigint): Promise<number | null> {
  const [trx] = await prisma.$queryRaw<Array<{ first: bigint | null }>>`
    SELECT MIN(transactions.date_timestamp) AS first ${ownershipSql(userId)}`;
  const accounts = await prisma.accounts.findMany({
    where: { users_user_id: userId },
    select: { created_timestamp: true },
  });
  const starts: number[] = [];
  if (trx?.first != null) starts.push(Number(trx.first));
  for (const a of accounts) if (a.created_timestamp != null) starts.push(Number(a.created_timestamp));
  if (starts.length) return Math.min(...starts);
  // Only accounts without a creation time: data exists, but there is no floor
  return accounts.length ? 0 : null;
}

/** A month the user has no data for: every check not set up, nothing computed or stored. */
const emptyHealth = (ym: YearMonth): StoredHealth => ({
  month: formatYearMonth(ym),
  passed: 0,
  total: 0,
  frozen: false,
  checks: KEYS.map((k) => check(k, 'not_set_up', null, txt('no_data', 'No data for this month yet'))),
});

const beforeData = (ym: YearMonth, start: number | null) => start == null || monthRangeIST(ym).to <= start;

async function forMonth(userId: bigint, ym: YearMonth, now: number): Promise<StoredHealth> {
  const { data, frozen } = await getOrFreeze<HealthScore>(
    userId,
    ym,
    'health',
    () => healthScore(userId, ym, now),
    now,
    freezeAfterGrace(ym)
  );
  return { ...data, frozen };
}

/**
 * The month's score. A past month is frozen on its first read on/after day 11 (IST) of the next
 * month; before that, and for the current month, it is live. Months before the user's data are a
 * cheap all-not-set-up result that is never stored.
 */
export async function healthForMonth(userId: bigint, ym: YearMonth, now: number = nowSeconds()): Promise<StoredHealth> {
  if (beforeData(ym, await dataStart(userId))) return emptyHealth(ym);
  return forMonth(userId, ym, now);
}

/**
 * The last 12 months, oldest first, ending with the current month (live). Frozen months come from
 * one query; the rest are computed one by one.
 */
export async function healthHistory(userId: bigint, now: number = nowSeconds()): Promise<StoredHealth[]> {
  const current = monthOfIST(now);
  const months = Array.from({ length: HISTORY_MONTHS }, (_, i) => shiftMonth(current, i - (HISTORY_MONTHS - 1)));
  const start = await dataStart(userId);
  const frozenRows = await prisma.monthly_records.findMany({
    where: {
      users_user_id: userId,
      kind: 'health',
      frozen_at: { not: null },
      month: { gte: monthKey(months[0]), lte: monthKey(current) },
    },
  });
  const frozen = new Map(frozenRows.map((r) => [r.month, r.data as unknown as HealthScore]));
  const out: StoredHealth[] = [];
  for (const ym of months) {
    const stored = frozen.get(monthKey(ym));
    if (stored) out.push({ ...stored, frozen: true });
    else if (beforeData(ym, start)) out.push(emptyHealth(ym));
    else out.push(await forMonth(userId, ym, now));
  }
  return out;
}

export default { healthScore, healthForMonth, healthHistory };
