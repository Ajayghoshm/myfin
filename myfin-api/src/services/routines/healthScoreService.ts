import { prisma } from '../../config/prisma.js';
import { MYFIN } from '../../consts.js';
import { listAccountsWithFreshness } from '../accountFreshnessService.js';
import { getFinancialProfile } from '../financialProfileService.js';
import { formatYearMonth, targetPercent } from '../insights/analyticsRules.js';
import { type YearMonth, monthRangeIST, shiftMonth } from '../insights/insightsPrimitives.js';
import { getMonthInsights } from '../insights/insightsService.js';
import { typicalMonth } from '../insights/typicalMonth.js';
import { emergencyFund } from '../planning/emergencyFundService.js';
import { sinkingStatus } from '../planning/yearlyCostService.js';
import { balancesAt } from '../wealth/netWorthService.js';
import { getOrFreeze, isPastMonth, monthOfIST } from './monthlyRecordService.js';

export type CheckStatus = 'pass' | 'fail' | 'not_set_up';
export type HealthCheckKey =
  | 'savings_rate'
  | 'emergency_fund'
  | 'yearly_costs'
  | 'fixed_costs'
  | 'credit_cards'
  | 'debt_emis'
  | 'data';
export type HealthCheck = { key: HealthCheckKey; status: CheckStatus; value: string | null; hint: string; link: string };
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
/** Balance checks for month M count until the end of this day of M+1. */
export const CHECK_GRACE_DAYS = 10;
const HISTORY_MONTHS = 12;
const DAY = 86_400;

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
const pct = (share: number) => `${Math.round(share * 100)} %`;
const money = (currency: number) => Math.round(currency).toLocaleString('en-IN');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const check = (key: HealthCheckKey, status: CheckStatus, value: string | null, hint: string): HealthCheck => ({
  key,
  status,
  value,
  hint,
  link: LINKS[key],
});

type Ctx = { userId: bigint; ym: YearMonth; range: { from: number; to: number }; now: number; stateNow: number };

async function savingsRateCheck(c: Ctx, typicalIncomeCents: number | null): Promise<HealthCheck> {
  const [profile, insights] = await Promise.all([getFinancialProfile(c.userId), getMonthInsights(c.userId, c.ym)]);
  const income = insights.summary.income;
  const typicalIncome = typicalIncomeCents != null && typicalIncomeCents > 0 ? typicalIncomeCents / 100 : null;
  const target = targetPercent(profile.savings_target_mode, profile.savings_target_value, income, typicalIncome);
  if (target == null) return check('savings_rate', 'not_set_up', null, 'Set a savings target in your profile');
  if (income <= 0 && typicalIncome == null)
    return check('savings_rate', 'not_set_up', null, 'No income recorded yet to measure the savings rate');
  const aim = `aim ≥ ${Math.round(target)} %`;
  const rate = insights.summary.savings_rate;
  if (rate == null) return check('savings_rate', 'fail', null, `No income this month (${aim})`);
  const status = rate * 100 + 1e-9 >= target ? 'pass' : 'fail';
  return check('savings_rate', status, pct(rate), `Savings rate is ${pct(rate)} (${aim})`);
}

async function emergencyFundCheck(c: Ctx): Promise<HealthCheck> {
  const ef = await emergencyFund(c.userId, c.stateNow);
  if (ef.status === 'no_accounts')
    return check('emergency_fund', 'not_set_up', null, 'Tick the accounts that hold your emergency fund');
  if (ef.status === 'no_fixed' || ef.months_covered == null)
    return check('emergency_fund', 'not_set_up', null, 'Mark your fixed-cost categories so the fund can be measured');
  const months = ef.months_covered.toFixed(1);
  const status = ef.months_covered >= ef.target_months ? 'pass' : 'fail';
  return check(
    'emergency_fund',
    status,
    `${months} of ${ef.target_months} months`,
    `Emergency fund covers ${months} months of fixed costs (aim ≥ ${ef.target_months})`
  );
}

async function yearlyCostsCheck(c: Ctx): Promise<HealthCheck> {
  const active = await prisma.yearly_costs.count({ where: { users_user_id: c.userId, active: true } });
  if (active === 0) return check('yearly_costs', 'not_set_up', null, 'Add your yearly costs');
  const s = await sinkingStatus(c.userId, c.stateNow);
  if (s.account == null) return check('yearly_costs', 'not_set_up', null, 'Choose a sinking-fund account for yearly costs');
  if (s.on_track) return check('yearly_costs', 'pass', 'on track', 'The sinking fund is on track for your yearly costs');
  return check(
    'yearly_costs',
    'fail',
    `behind by ${money(s.behind_by)}`,
    `The sinking fund is behind by ${money(s.behind_by)} (aim: on track)`
  );
}

async function fixedCostsCheck(c: Ctx, typical: { incomeCents: number | null; fixedCents: number | null }): Promise<HealthCheck> {
  const fixedCats = await prisma.categories.count({ where: { users_user_id: c.userId, is_fixed: true } });
  if (fixedCats === 0) return check('fixed_costs', 'not_set_up', null, 'Mark your fixed-cost categories');
  if (typical.incomeCents == null || typical.incomeCents <= 0)
    return check('fixed_costs', 'not_set_up', null, 'Not enough income history yet for a typical month');
  const share = (typical.fixedCents ?? 0) / typical.incomeCents;
  return check(
    'fixed_costs',
    share <= FIXED_SHARE_MAX + 1e-9 ? 'pass' : 'fail',
    `${pct(share)} of income`,
    `Fixed costs are ${pct(share)} of income (aim ≤ ${pct(FIXED_SHARE_MAX)})`
  );
}

async function debtEmisCheck(c: Ctx, typicalIncomeCents: number | null): Promise<HealthCheck> {
  // Open loans (as owned by loanService): kind 'loan', status 'open'; EMI in cents.
  const loans = await prisma.debts.findMany({
    where: { users_user_id: c.userId, kind: 'loan', status: 'open' },
    select: { emi: true },
  });
  if (loans.length === 0) return check('debt_emis', 'not_set_up', null, 'No open loans to check');
  if (typicalIncomeCents == null || typicalIncomeCents <= 0)
    return check('debt_emis', 'not_set_up', null, 'Not enough income history yet for a typical month');
  const emiCents = loans.reduce((s, l) => s + Number(l.emi ?? 0n), 0);
  const share = emiCents / typicalIncomeCents;
  return check(
    'debt_emis',
    share <= EMI_SHARE_MAX + 1e-9 ? 'pass' : 'fail',
    `${pct(share)} of income`,
    `Loan EMIs are ${pct(share)} of income (aim ≤ ${pct(EMI_SHARE_MAX)})`
  );
}

/**
 * Each active card's reference balance: its latest balance check dated in M (the real balance), else
 * its balance at the end of M−1. A negative balance is cleared when transfers into the card within
 * 35 days after the reference time cover it (less ₹1). The 35-day window is judged against the real
 * `now`, because it runs past the end of M.
 */
async function creditCardsCheck(c: Ctx): Promise<HealthCheck> {
  const cards = await prisma.accounts.findMany({
    where: { users_user_id: c.userId, type: MYFIN.ACCOUNT_TYPES.CREDIT, status: MYFIN.ACCOUNT_STATUS.ACTIVE },
    select: { account_id: true },
    orderBy: { account_id: 'asc' },
  });
  if (cards.length === 0) return check('credit_cards', 'not_set_up', null, 'Add your credit-card accounts');

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

  let cleared = 0;
  let failed = 0;
  let pending = 0;
  for (const r of refs) {
    const owed = -(r.cents ?? 0);
    if (owed <= 0) {
      cleared++;
      continue;
    }
    const until = r.at + CARD_CLEAR_DAYS * DAY;
    const paid = await prisma.transactions.aggregate({
      where: {
        accounts_account_to_id: r.id,
        type: MYFIN.TRX_TYPES.TRANSFER,
        date_timestamp: { gte: r.at, lt: until },
      },
      _sum: { amount: true },
    });
    if (Number(paid._sum.amount ?? 0n) >= owed - CARD_TOLERANCE_CENTS) cleared++;
    else if (c.now >= until) failed++;
    else pending++;
  }
  if (failed > 0)
    return check(
      'credit_cards',
      'fail',
      `${plural(failed, 'card', 'cards')} not paid in full`,
      `${plural(failed, 'card was', 'cards were')} not paid in full within ${CARD_CLEAR_DAYS} days (aim: pay the full balance)`
    );
  if (cleared === 0)
    return check(
      'credit_cards',
      'not_set_up',
      null,
      `Card payments are still within the ${CARD_CLEAR_DAYS}-day window`
    );
  return check(
    'credit_cards',
    'pass',
    'paid in full',
    `Card balances were paid in full within ${CARD_CLEAR_DAYS} days`
  );
}

/**
 * No active freshness-enabled account is stale (as of `stateNow`), and each has a balance check
 * dated in M or within the first 10 days of M+1. A missing check only fails once that grace period
 * has passed (judged against the real `now`); until then it is pending.
 */
async function dataCheck(c: Ctx): Promise<HealthCheck> {
  const accounts = await listAccountsWithFreshness(c.userId, c.stateNow);
  const enabled = accounts.filter(
    (a) => a.status === MYFIN.ACCOUNT_STATUS.ACTIVE && a.stale_after_days_effective != null
  );
  if (enabled.length === 0) return check('data', 'not_set_up', null, 'Turn on freshness tracking for your accounts');

  const stale = enabled.filter((a) => a.freshness === 'stale').length;
  const deadline = monthRangeIST(shiftMonth(c.ym, 1)).from + CHECK_GRACE_DAYS * DAY;
  const checked = await prisma.balance_checks.groupBy({
    by: ['accounts_account_id'],
    where: {
      accounts_account_id: { in: enabled.map((a) => a.account_id) },
      checked_at: { gte: c.range.from, lt: deadline },
    },
  });
  const checkedIds = new Set(checked.map((r) => r.accounts_account_id.toString()));
  const unchecked = enabled.filter((a) => !checkedIds.has(a.account_id.toString())).length;
  const checksOverdue = unchecked > 0 && c.now >= deadline;

  if (stale > 0)
    return check(
      'data',
      'fail',
      plural(stale, 'stale account', 'stale accounts'),
      `${plural(stale, 'account is', 'accounts are')} stale; import their transactions (aim: none stale)`
    );
  if (checksOverdue)
    return check(
      'data',
      'fail',
      `${plural(unchecked, 'account', 'accounts')} not checked`,
      `${plural(unchecked, 'account has', 'accounts have')} no balance check for this month (aim: check by day ${CHECK_GRACE_DAYS} of next month)`
    );
  if (unchecked > 0)
    return check(
      'data',
      'pass',
      'up to date',
      `Accounts are up to date; check balances by day ${CHECK_GRACE_DAYS} of next month`
    );
  return check('data', 'pass', 'up to date', 'Accounts are up to date and balances checked');
}

/**
 * The health checklist for month `ym`. For a past month, the checks that read "current" state
 * (emergency fund, sinking fund, staleness) are evaluated with `now` = the last second of the month;
 * those services still read today's account balances. Loans are their current state. The card
 * window and balance-check grace period are judged against the real `now`.
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

/** The month's score; a past month is frozen on its first read, the current month is live. */
export async function healthForMonth(userId: bigint, ym: YearMonth, now: number = nowSeconds()): Promise<StoredHealth> {
  const { data, frozen } = await getOrFreeze(userId, ym, 'health', () => healthScore(userId, ym, now), now);
  return { ...data, frozen };
}

/** The last 12 months, oldest first, ending with the current month (live). */
export async function healthHistory(userId: bigint, now: number = nowSeconds()): Promise<StoredHealth[]> {
  const current = monthOfIST(now);
  const out: StoredHealth[] = [];
  for (let i = HISTORY_MONTHS - 1; i >= 0; i--) out.push(await healthForMonth(userId, shiftMonth(current, -i), now));
  return out;
}

export default { healthScore, healthForMonth, healthHistory };
