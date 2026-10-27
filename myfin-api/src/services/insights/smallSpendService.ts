import { MYFIN } from '../../consts.js';
import { getFinancialProfile } from '../financialProfileService.js';
import { formatYearMonth, salaryRuleFor } from './analyticsRules.js';
import { type YearMonth, monthRangeIST, shiftMonth } from './insightsPrimitives.js';
import { BASELINE_MONTHS, computeTypical, fetchRows } from './typicalMonth.js';

export type SmallSpends = {
  month: string;
  cutoff: number;
  count: number;
  total: number;
  typical_total: number | null;
  typical_count: number | null;
  places: { payee_key: string; name: string; count: number; total: number; average: number }[];
  trend: { year: number; month: number; count: number; total: number }[];
};

const TREND_MONTHS = 12;
const TOP_PLACES = 10;
const NO_DESCRIPTION = '(no description)';

const money = (cents: number) => Math.round(cents) / 100;

/** Small-spend leakage: counted expenses below the user's cut-off, for the selected effective month. */
export async function smallSpends(userId: bigint, ym: YearMonth): Promise<SmallSpends> {
  const months = Array.from({ length: TREND_MONTHS }, (_, i) => shiftMonth(ym, i - (TREND_MONTHS - 1)));
  const sel = TREND_MONTHS - 1;
  const baselineIdx = Array.from({ length: BASELINE_MONTHS }, (_, i) => sel - BASELINE_MONTHS + i);

  const [rule, profile] = await Promise.all([salaryRuleFor(userId), getFinancialProfile(userId)]);
  const cutoff = profile.small_spend_cutoff;
  const cutoffCents = Math.round(cutoff * 100);
  const rows = await fetchRows(userId, months, months.map(monthRangeIST), rule);
  const small = rows.filter((r) => r.type === MYFIN.TRX_TYPES.EXPENSE && r.cents < cutoffCents);

  const perMonth = months.map(() => ({ count: 0, cents: 0 }));
  for (const r of small) {
    perMonth[r.monthIdx].count += 1;
    perMonth[r.monthIdx].cents += r.cents;
  }

  // Typical: average over the shared baseline months that have data (any counted row).
  // Yearly-cost rows and the typical month's one-offs stay out of the baseline sums.
  const { baselineN, typical } = computeTypical(rows, baselineIdx);
  const n = baselineN;
  const baseSmall = small.filter(
    (r) => baselineIdx.includes(r.monthIdx) && !r.yearlyCost && !typical.oneOffIds.has(r.id.toString())
  );
  const typicalCents = n > 0 ? baseSmall.reduce((s, r) => s + r.cents, 0) / n : null;
  const typicalCount = n > 0 ? baseSmall.length / n : null;

  const agg = new Map<string, { count: number; cents: number }>();
  for (const r of small.filter((r) => r.monthIdx === sel)) {
    const a = agg.get(r.payeeKey) ?? { count: 0, cents: 0 };
    a.count += 1;
    a.cents += r.cents;
    agg.set(r.payeeKey, a);
  }
  const places = [...agg.entries()]
    .sort((a, b) => b[1].cents - a[1].cents || b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, TOP_PLACES)
    .map(([key, a]) => ({
      payee_key: key,
      name: key === '' ? NO_DESCRIPTION : key,
      count: a.count,
      total: money(a.cents),
      average: money(a.cents / a.count),
    }));

  return {
    month: formatYearMonth(ym),
    cutoff,
    count: perMonth[sel].count,
    total: money(perMonth[sel].cents),
    typical_total: typicalCents == null ? null : money(typicalCents),
    typical_count: typicalCount == null ? null : Math.round(typicalCount * 100) / 100,
    places,
    trend: months.map((m, i) => ({ year: m.year, month: m.month, count: perMonth[i].count, total: money(perMonth[i].cents) })),
  };
}

export default { smallSpends };
