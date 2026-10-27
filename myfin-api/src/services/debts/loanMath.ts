/**
 * Pure loan arithmetic in cents. Dates are YYYY-MM-DD calendar days (IST in the services).
 */

export type ScheduleRow = {
  n: number;
  date: string;
  emi: number;
  interest: number;
  principal: number;
  /** Principal left after this installment. */
  balance: number;
};

export type PrepaymentResult = { months_saved: number; interest_saved: number; new_end_date: string };

const monthlyRate = (annualRatePct: number) => annualRatePct / 12 / 100;

const pad = (v: number) => String(v).padStart(2, '0');

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** YYYY-MM-DD for `day` of a month (1-12), clamped to the month's length. */
export function firstEmiDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
}

/** The date `months` after a YYYY-MM-DD date, on `day` (clamped to the month's length). */
function addMonths(date: string, months: number, day: number): string {
  const [y, m] = date.split('-').map(Number);
  const idx = y * 12 + (m - 1) + months;
  return firstEmiDate(Math.floor(idx / 12), (idx % 12) + 1, day);
}

/** Monthly EMI in cents (rounded). At 0 % it is the principal over the months, rounded up to the cent. */
export function emiFor(principalCents: number, annualRatePct: number, months: number): number {
  if (months <= 0) return principalCents;
  const r = monthlyRate(annualRatePct);
  if (r === 0) return Math.ceil(principalCents / months);
  const f = (1 + r) ** months;
  return Math.round((principalCents * r * f) / (f - 1));
}

/**
 * Amortisation schedule. Interest = round(balance × monthly rate); principal = EMI − interest.
 * The last row (or the row that clears the balance early) pays exactly what is left, its EMI adjusted.
 * `emiDay` is the nominal day of month (defaults to the start date's day), clamped per month.
 */
export function schedule(
  principalCents: number,
  annualRatePct: number,
  months: number,
  emiCents: number,
  startDate: string,
  emiDay?: number
): ScheduleRow[] {
  const r = monthlyRate(annualRatePct);
  const day = emiDay ?? Number(startDate.slice(8, 10));
  const rows: ScheduleRow[] = [];
  let balance = principalCents;
  for (let n = 1; n <= months && balance > 0; n++) {
    const interest = Math.round(balance * r);
    let principal = emiCents - interest;
    if (n === months || principal >= balance) principal = balance;
    balance -= principal;
    rows.push({
      n,
      date: n === 1 ? startDate : addMonths(startDate, n - 1, day),
      emi: interest + principal,
      interest,
      principal,
      balance,
    });
  }
  return rows;
}

/**
 * Paying `prepayCents` extra right after installment `afterInstallment` (0 = before the first) and
 * keeping the same EMI: how many EMIs and how much interest that saves, and the new last EMI date.
 * The monthly rate is `annualRatePct` when given, else derived from the first row.
 */
export function prepaymentWhatIf(
  sched: ScheduleRow[],
  afterInstallment: number,
  prepayCents: number,
  annualRatePct?: number
): PrepaymentResult {
  if (sched.length === 0) return { months_saved: 0, interest_saved: 0, new_end_date: '' };
  const k = Math.max(0, Math.min(afterInstallment, sched.length));
  const first = sched[0];
  const opening = first.balance + first.principal;
  const r = annualRatePct != null ? monthlyRate(annualRatePct) : opening > 0 ? first.interest / opening : 0;
  const emi = first.emi;
  const remaining = sched.slice(k);
  const oldInterest = remaining.reduce((s, row) => s + row.interest, 0);
  let balance = (k === 0 ? opening : sched[k - 1].balance) - Math.max(0, prepayCents);

  let count = 0;
  let newInterest = 0;
  while (balance > 0 && count < remaining.length) {
    const interest = Math.round(balance * r);
    let principal = emi - interest;
    if (count === remaining.length - 1 || principal >= balance) principal = balance;
    newInterest += interest;
    balance -= principal;
    count++;
  }
  const endRow = count > 0 ? remaining[count - 1] : (sched[k - 1] ?? first);
  return {
    months_saved: remaining.length - count,
    interest_saved: Math.max(0, oldInterest - newInterest),
    new_end_date: endRow.date,
  };
}
