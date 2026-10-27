/**
 * Savings-target as a percent of income. 'percent' mode: the value itself
 * (0 -> null). 'amount' mode: value / income x 100, using the month's income,
 * or typical income when the month has none; null when there is no base.
 */
export function targetPercent(
  mode: 'amount' | 'percent',
  value: number,
  monthIncome: number,
  typicalIncome: number | null,
): number | null {
  if (!value) return null;
  if (mode === 'percent') return value;
  const base = monthIncome > 0 ? monthIncome : typicalIncome;
  if (!base || base <= 0) return null;
  return (value / base) * 100;
}

/** (sum income - sum spending) / sum income x 100; null when income is 0. */
export function twelveMonthAverage(
  trend: { income: number; spending: number }[],
): number | null {
  const income = trend.reduce((s, m) => s + m.income, 0);
  if (income <= 0) return null;
  const spending = trend.reduce((s, m) => s + m.spending, 0);
  return ((income - spending) / income) * 100;
}
