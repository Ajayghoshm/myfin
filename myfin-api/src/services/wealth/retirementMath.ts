/**
 * Retirement / FIRE maths (pure). Rates are percent per year; money is in currency units.
 * Closed forms are used with explicit limit branches so no input with SWR > 0 yields NaN or Infinity.
 */

export type RetirementInputs = {
  age: number;
  retirementAge: number;
  annualSpendingToday: number;
  returnPct: number;
  inflationPct: number;
  swrPct: number;
  familySupportMonthly: number;
  familySupportYears: number;
  currentCorpus: number;
  monthlyInvestment: number;
};

export type ProjectionRow = { age: number; corpus: number; needed: number };

export const PROJECTION_END_AGE = 90;
const EPS = 1e-9;

const finite = (v: number) => (Number.isFinite(v) ? v : 0);

/** Corpus needed to retire at `atAge` (default: retirementAge), in then-rupees (future) and today's rupees. */
export function corpusNeeded(i: RetirementInputs, atAge: number = i.retirementAge): { future: number; today: number } {
  const n = Math.max(0, atAge - i.age);
  const inf = i.inflationPct / 100;
  const r = i.returnPct / 100;
  const inflator = (1 + inf) ** n;
  const swr = i.swrPct / 100;
  if (!(swr > 0)) return { future: 0, today: 0 };

  const base = (i.annualSpendingToday * inflator) / swr;

  let family = 0;
  const years = Math.max(0, Math.floor(i.familySupportYears));
  if (i.familySupportMonthly > 0 && years > 0) {
    const a = 12 * i.familySupportMonthly * inflator;
    family =
      Math.abs(r - inf) < EPS
        ? (a * years) / (1 + r)
        : (a * (1 - ((1 + inf) / (1 + r)) ** years)) / (r - inf);
  }

  const future = finite(base + family);
  return { future, today: finite(future / inflator) };
}

export function projection(i: RetirementInputs): ProjectionRow[] {
  const rows: ProjectionRow[] = [];
  const r = i.returnPct / 100;
  let corpus = i.currentCorpus;
  for (let age = i.age; age <= PROJECTION_END_AGE; age++) {
    rows.push({ age, corpus: finite(corpus), needed: corpusNeeded(i, age).future });
    corpus = corpus * (1 + r) + 12 * i.monthlyInvestment;
  }
  return rows;
}

/** First age >= the current one where the corpus covers what retiring then would need; null if never by 90. */
export function onTrackAge(i: RetirementInputs): number | null {
  return projection(i).find((row) => row.corpus >= row.needed)?.age ?? null;
}

/** Extra monthly investing (on top of the current amount) closing the gap at the retirement age; never negative. */
export function extraMonthlyNeeded(i: RetirementInputs): number {
  const n = i.retirementAge - i.age;
  const r = i.returnPct / 100;
  const need = corpusNeeded(i).future;
  const gap = need - i.currentCorpus * (1 + r) ** Math.max(0, n);
  if (!(gap > 0)) return 0;
  let yearly: number;
  if (n <= 0) yearly = gap;
  else if (Math.abs(r) < EPS) yearly = gap / n;
  else yearly = (gap * r) / ((1 + r) ** n - 1);
  return Math.max(0, finite(yearly / 12 - i.monthlyInvestment));
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' that is a real calendar date, no earlier than 1900. */
export function parseDob(dob: string): { y: number; m: number; d: number } | null {
  const match = YMD.exec(dob);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || y < 1900) return null;
  return { y, m, d };
}

const IST_OFFSET_SECONDS = 19800;

/** Today in IST as 'YYYY-MM-DD' for an epoch-seconds instant. */
export function istToday(nowSeconds: number): string {
  return new Date((nowSeconds + IST_OFFSET_SECONDS) * 1000).toISOString().slice(0, 10);
}

/** Whole years from a valid date of birth to IST today; null when the date is invalid or in the future. */
export function ageOn(dob: string, nowSeconds: number): number | null {
  const p = parseDob(dob);
  if (!p) return null;
  const t = parseDob(istToday(nowSeconds));
  if (!t) return null;
  if (p.y * 10000 + p.m * 100 + p.d > t.y * 10000 + t.m * 100 + t.d) return null;
  return t.y - p.y - (t.m < p.m || (t.m === p.m && t.d < p.d) ? 1 : 0);
}
