import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import APIError from '../../errorHandling/apiError.js';
import { getFinancialProfile } from '../financialProfileService.js';
import GoalService from '../goalService.js';
import { formatYearMonth, targetPercent } from '../insights/analyticsRules.js';
import { getMonthInsights } from '../insights/insightsService.js';
import { type YearMonth, monthRangeIST, shiftMonth } from '../insights/insightsPrimitives.js';
import { emergencyFund } from '../planning/emergencyFundService.js';
import { netWorthAt } from '../wealth/netWorthService.js';
import { MILESTONE_KINDS, type MilestoneKind } from './milestoneKinds.js';
import { monthKey, monthOfIST } from './monthlyRecordService.js';

export { MILESTONE_KINDS, type MilestoneKind };

/** Net-worth thresholds in rupees: ₹1L, 5L, 10L, 25L, 50L, 1Cr. */
export const NET_WORTH_THRESHOLDS = [100000, 500000, 1000000, 2500000, 5000000, 10000000] as const;

/** Consecutive ended months that make a streak. */
const STREAK = 3;
/** On a first-ever evaluation, goal_funded / debt_cleared achieved this recently still get a banner. */
const RECENT_SECONDS = 30 * 86_400;

export type Milestone = {
  milestone_id: string;
  kind: MilestoneKind;
  key: string;
  achieved_at: number;
  dismissed: boolean;
  /** Label parameters (amounts in currency, months as YYYY-MM, ids as strings). */
  data: Record<string, unknown> | null;
};

type Candidate = {
  kind: MilestoneKind;
  key: string;
  achieved_at: number;
  /** Orders candidates of one kind: the highest is "the latest / highest" on a first evaluation. */
  rank: number;
  /**
   * False when achieved_at is only the evaluation time (no real achievement date). A first-ever
   * evaluation never shows a goal_funded / debt_cleared banner for those (ruling E6).
   */
  dateKnown?: boolean;
  data: Record<string, unknown>;
};

type Row = {
  milestone_id: bigint;
  kind: string;
  key: string;
  achieved_at: bigint;
  dismissed: boolean;
  data: Prisma.JsonValue;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

const toDto = (r: Row): Milestone => ({
  milestone_id: r.milestone_id.toString(),
  kind: r.kind as MilestoneKind,
  key: r.key,
  achieved_at: Number(r.achieved_at),
  dismissed: r.dismissed,
  data: (r.data as Record<string, unknown> | null) ?? null,
});

const ymOfKey = (key: number): YearMonth => ({ year: Math.floor(key / 100), month: key % 100 });
/** The moment month `ym` ended (start of the next IST month). */
const endOf = (ym: YearMonth) => monthRangeIST(shiftMonth(ym, 1)).from;

/**
 * Finds runs of `STREAK` consecutive passing months that start fresh: the month before the run is
 * known and does not pass. `pass(i)` is null when month i is unknown (it is also asked for i = -1);
 * a run whose previous month is unknown is skipped, since it began before the data and was reported
 * back then. Returns the indexes of each run's last (3rd) month.
 */
function freshStreakEnds(count: number, pass: (i: number) => boolean | null): number[] {
  const out: number[] = [];
  for (let end = STREAK - 1; end < count; end++) {
    const start = end - STREAK + 1;
    let ok = true;
    for (let i = start; i <= end; i++) if (pass(i) !== true) ok = false;
    if (ok && pass(start - 1) === false) out.push(end);
  }
  return out;
}

async function netWorthCandidates(userId: bigint, now: number): Promise<Candidate[]> {
  const { totalCents } = await netWorthAt(userId, now + 1);
  return NET_WORTH_THRESHOLDS.filter((t) => totalCents >= t * 100).map((t) => ({
    kind: 'net_worth',
    key: String(t),
    achieved_at: now,
    rank: t,
    data: { amount: t },
  }));
}

async function emergencyCandidates(userId: bigint, now: number): Promise<Candidate[]> {
  const ef = await emergencyFund(userId, now);
  if (ef.months_covered == null) return [];
  const out: Candidate[] = [];
  // "3 months, then the target": the 3-month step only exists below a target above 3
  if (ef.target_months > 3 && ef.months_covered >= 3)
    out.push({ kind: 'emergency_3m', key: '3', achieved_at: now, rank: 3, data: { months: 3 } });
  if (ef.target_months > 0 && ef.months_covered >= ef.target_months)
    out.push({
      kind: 'emergency_target',
      key: String(ef.target_months),
      achieved_at: now,
      rank: ef.target_months,
      data: { months: ef.target_months },
    });
  return out;
}

async function goalCandidates(userId: bigint, now: number): Promise<Candidate[]> {
  const { goals } = await GoalService.getGoalsForUser(userId, true, prisma, now);
  return goals
    .filter((g) => !g.is_archived && g.amount > 0 && g.currently_funded_amount + 0.005 >= g.amount)
    .map((g) => ({
      kind: 'goal_funded',
      key: String(g.goal_id),
      achieved_at: now,
      rank: now,
      dateKnown: false,
      data: { goal_id: String(g.goal_id), name: g.name, amount: g.amount },
    }));
}

async function debtCandidates(userId: bigint, now: number): Promise<Candidate[]> {
  const debts = await prisma.debts.findMany({
    where: { users_user_id: userId, status: 'settled' },
    select: { debt_id: true, kind: true, counterparty_name: true, principal: true },
  });
  if (debts.length === 0) return [];
  // The last payment is when it was cleared; without payments, now
  const last = await prisma.debt_payments.groupBy({
    by: ['debts_debt_id'],
    where: { debts_debt_id: { in: debts.map((d) => d.debt_id) } },
    _max: { date: true },
  });
  const lastBy = new Map(last.map((l) => [l.debts_debt_id.toString(), l._max.date]));
  return debts.map((d) => {
    const paid = lastBy.get(d.debt_id.toString());
    const achieved = paid != null ? Math.min(Number(paid), now) : now;
    return {
      kind: 'debt_cleared',
      key: d.debt_id.toString(),
      achieved_at: achieved,
      rank: achieved,
      dateKnown: paid != null,
      data: { debt_id: d.debt_id.toString(), name: d.counterparty_name, kind: d.kind, amount: Number(d.principal) / 100 },
    };
  });
}

/**
 * Savings from the Insights trend of the 12 effective months ending with the last ended month
 * (the current month never counts). Months with no income are ignored for the best month and
 * break a streak.
 */
async function savingsCandidates(userId: bigint, now: number): Promise<Candidate[]> {
  const lastEnded = shiftMonth(monthOfIST(now), -1);
  const [{ trend }, profile] = await Promise.all([getMonthInsights(userId, lastEnded), getFinancialProfile(userId)]);
  const out: Candidate[] = [];
  const months = trend.map((t) => ({ ym: { year: t.year, month: t.month }, income: t.income, rate: t.savings_rate }));

  // Best month: the latest month beating every earlier month with income (needs one earlier month)
  let best: number | null = null;
  let bestIdx: number | null = null;
  let seen = 0;
  for (let i = 0; i < months.length; i++) {
    const m = months[i];
    if (m.income <= 0 || m.rate == null) continue;
    if (best == null || m.rate > best) {
      if (seen > 0) bestIdx = i;
      best = m.rate;
    }
    seen++;
  }
  if (bestIdx != null) {
    const m = months[bestIdx];
    out.push({
      kind: 'best_savings_month',
      key: formatYearMonth(m.ym),
      achieved_at: endOf(m.ym),
      rank: monthKey(m.ym),
      data: { month: formatYearMonth(m.ym), rate: m.rate },
    });
  }

  // Streak: 3 ended months in a row at or above the savings target (none without a target)
  if (profile.savings_target_value) {
    const passes = months.map((m) => {
      if (m.income <= 0 || m.rate == null) return false;
      const target = targetPercent(profile.savings_target_mode, profile.savings_target_value, m.income, null);
      return target != null && m.rate * 100 + 1e-9 >= target;
    });
    for (const end of freshStreakEnds(months.length, (i) => (i < 0 ? null : passes[i]))) {
      const m = months[end];
      out.push({
        kind: 'savings_streak',
        key: formatYearMonth(m.ym),
        achieved_at: endOf(m.ym),
        rank: monthKey(m.ym),
        data: { month: formatYearMonth(m.ym), from: formatYearMonth(months[end - STREAK + 1].ym) },
      });
    }
  }
  return out;
}

/** Health and review: stored frozen records of ended months only (never triggers a freeze). */
async function recordCandidates(userId: bigint, now: number): Promise<Candidate[]> {
  const current = monthKey(monthOfIST(now));
  const records = await prisma.monthly_records.findMany({
    where: { users_user_id: userId, frozen_at: { not: null }, month: { lt: current } },
    orderBy: { month: 'asc' },
  });
  const out: Candidate[] = [];
  for (const r of records) {
    if (r.kind !== 'health') continue;
    const d = (r.data ?? {}) as { passed?: unknown; total?: unknown };
    const total = Number(d.total);
    if (!(total > 0) || Number(d.passed) !== total) continue;
    const ym = ymOfKey(r.month);
    out.push({
      kind: 'health_all_pass',
      key: formatYearMonth(ym),
      achieved_at: endOf(ym),
      rank: r.month,
      data: { month: formatYearMonth(ym), passed: total, total },
    });
  }

  const reviews = records.filter((r) => r.kind === 'review');
  if (reviews.length > 0) {
    const complete = new Map(reviews.map((r) => [r.month, (r.data as { complete?: unknown })?.complete === true]));
    // Every calendar month from the first frozen review to the last ended month; a missing month breaks a run
    const first = ymOfKey(reviews[0].month);
    const months: YearMonth[] = [];
    for (let m = first; monthKey(m) < current; m = shiftMonth(m, 1)) months.push(m);
    // Frozen reviews are kept forever, so the month before the first one is known: not complete
    const pass = (i: number) => i >= 0 && complete.get(monthKey(months[i])) === true;
    for (const end of freshStreakEnds(months.length, pass)) {
      const ym = months[end];
      const start = end - STREAK + 1;
      out.push({
        kind: 'review_streak',
        key: formatYearMonth(ym),
        achieved_at: endOf(ym),
        rank: monthKey(ym),
        data: { month: formatYearMonth(ym), from: formatYearMonth(months[start]) },
      });
    }
  }
  return out;
}

/** Every milestone currently achieved (idempotent: the unique key decides what is new). */
async function candidates(userId: bigint, now: number): Promise<Candidate[]> {
  const groups = await Promise.all([
    netWorthCandidates(userId, now),
    emergencyCandidates(userId, now),
    goalCandidates(userId, now),
    savingsCandidates(userId, now),
    recordCandidates(userId, now),
    debtCandidates(userId, now),
  ]);
  return groups.flat();
}

/**
 * First-ever evaluation: only the highest net-worth threshold, the latest of each other kind, and
 * every goal_funded / debt_cleared with a known achievement date in the last 30 days get a banner;
 * the rest (including goals, whose funding date is never known, and payment-less debts) go silently
 * to the timeline (dismissed). Later evaluations insert everything undismissed.
 */
function firstEvaluationShown(list: Candidate[], now: number): Set<Candidate> {
  const shown = new Set<Candidate>();
  const top = new Map<string, Candidate>();
  for (const c of list) {
    if (c.kind === 'goal_funded' || c.kind === 'debt_cleared') {
      if (c.dateKnown === true && c.achieved_at >= now - RECENT_SECONDS) shown.add(c);
      continue;
    }
    const cur = top.get(c.kind);
    if (!cur || c.rank > cur.rank) top.set(c.kind, c);
  }
  for (const c of top.values()) shown.add(c);
  return shown;
}

/**
 * Inserts every newly achieved milestone (createMany + skipDuplicates on the unique (user, kind,
 * key), so it is idempotent and safe to run concurrently; a dip and recovery never re-fires).
 * "First-ever" means the user has never been evaluated (profile.milestones_evaluated_at is null),
 * even when that evaluation found nothing.
 *
 * Returns every undismissed milestone of the user (new in this call or not yet dismissed from an
 * earlier one), newest first: the banner keeps showing until the user dismisses it.
 */
export async function evaluateMilestones(userId: bigint, now: number = nowSeconds()): Promise<Milestone[]> {
  const list = await candidates(userId, now);
  // The profile row carries milestones_evaluated_at; make sure it exists so it can be claimed
  // (skipDuplicates: a concurrent insert of the same row is fine, unlike upsert's race)
  await prisma.user_financial_profile.createMany({
    data: [{ users_user_id: userId, updated_at: BigInt(now) }],
    skipDuplicates: true,
  });
  await prisma.$transaction(async (tx) => {
    // Claims the first-ever evaluation. The conditional update locks the profile row until commit,
    // so a concurrent first evaluation waits, then finds it set and applies the normal rule.
    const { count } = await tx.user_financial_profile.updateMany({
      where: { users_user_id: userId, milestones_evaluated_at: null },
      data: { milestones_evaluated_at: BigInt(now) },
    });
    if (list.length === 0) return;
    const shown = count === 1 ? firstEvaluationShown(list, now) : null;
    await tx.milestones.createMany({
      data: list.map((c) => ({
        users_user_id: userId,
        kind: c.kind,
        key: c.key,
        achieved_at: BigInt(c.achieved_at),
        dismissed: shown != null && !shown.has(c),
        data: c.data as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
  });
  const rows = await prisma.milestones.findMany({
    where: { users_user_id: userId, dismissed: false },
    orderBy: [{ achieved_at: 'desc' }, { milestone_id: 'desc' }],
  });
  return rows.map(toDto);
}

/** The timeline: every milestone, newest first. */
export async function listMilestones(userId: bigint): Promise<Milestone[]> {
  const rows = await prisma.milestones.findMany({
    where: { users_user_id: userId },
    orderBy: [{ achieved_at: 'desc' }, { milestone_id: 'desc' }],
  });
  return rows.map(toDto);
}

export async function dismissMilestone(userId: bigint, milestoneId: bigint): Promise<Milestone> {
  const { count } = await prisma.milestones.updateMany({
    where: { milestone_id: milestoneId, users_user_id: userId },
    data: { dismissed: true },
  });
  if (count === 0) throw APIError.notAuthorized();
  return toDto(await prisma.milestones.findUniqueOrThrow({ where: { milestone_id: milestoneId } }));
}

export default { evaluateMilestones, listMilestones, dismissMilestone, MILESTONE_KINDS };
