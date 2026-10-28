import { MYFIN } from '../../consts.js';
import { emiFor, firstEmiDate, schedule } from '../../services/debts/loanMath.js';
import {
  type YearMonth,
  monthRangeIST,
  shiftMonth,
} from '../../services/insights/insightsPrimitives.js';
import { istDate } from '../../services/routines/eventDates.js';

/**
 * The demo user's money in one place, built in memory (no database): an Indian salaried household
 * over the 6 full months before the current IST month plus the current month up to now. Amounts are
 * rupees; the variation is deterministic, so two runs on the same day give the same rows.
 */

export type AccountKey = 'salary' | 'savings' | 'sinking' | 'invest' | 'card';
export type CategoryKey =
  | 'salary'
  | 'bonus'
  | 'loanInterest'
  | 'utilities'
  | 'mobile'
  | 'insurance'
  | 'groceries'
  | 'eatingOut'
  | 'fuel'
  | 'shopping'
  | 'entertainment'
  | 'health'
  | 'gifts';
export type EntityKey =
  | 'employer'
  | 'dmart'
  | 'relianceFresh'
  | 'swiggy'
  | 'zomato'
  | 'kseb'
  | 'indianOil'
  | 'amazon'
  | 'hdfc'
  | 'zerodha'
  | 'lic'
  | 'croma'
  | 'pvr';

export type DemoTrx = {
  /** Rows the feature step links to (EMIs, debts, the LIC premium, card bills). */
  key?: string;
  date: number;
  rupees: number;
  type: string;
  description: string;
  from?: AccountKey;
  to?: AccountKey;
  category?: CategoryKey;
  entity?: EntityKey;
  essential?: boolean;
  adjustment?: boolean;
};

export type DemoBuy = {
  asset: 'nifty' | 'ppf';
  date: number;
  rupees: number;
  units: number;
  note: string;
};
export type DemoValue = { asset: 'nifty' | 'ppf'; ym: YearMonth; rupees: number };
export type DemoBudget = {
  ym: YearMonth;
  isOpen: boolean;
  observations: string;
  lines: Array<{ category: CategoryKey; debit: number; credit: number }>;
};

export type DemoCalendar = { now: number; current: YearMonth; today: string };

/** First month of data, relative to the current month. */
export const FIRST_OFFSET = -6;
export const SALARY = 120_000;
export const SAVINGS_TRANSFER = 20_000;
export const SINKING_TRANSFER = 4_000;
export const SIP = 15_000;
export const BONUS = 200_000;
export const LAPTOP = 85_000;
export const LIC_PREMIUM = 24_000;
export const CAR_INSURANCE = 18_000;
export const LENT_TO_ARJUN = 5_000;
export const ARJUN_REPAID = 2_000;
export const BORROWED_FROM_MEERA = 3_000;

export const LOAN = {
  lender: 'HDFC Home Loan',
  principal: 2_500_000,
  rate: 8.5,
  tenureMonths: 240,
  emiDay: 5,
  /** The first EMI's month, relative to the current month. */
  startOffset: -24,
};

const DAY = 86_400;

export function demoCalendar(now: number = Math.floor(Date.now() / 1000)): DemoCalendar {
  const today = istDate(now);
  return {
    now,
    current: { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) },
    today,
  };
}

export const monthAt = (cal: DemoCalendar, offset: number) => shiftMonth(cal.current, offset);

/** Epoch second of `day` (clamped to the month's length) at `hour`:00 IST. */
export function dayEpoch(ym: YearMonth, day: number, hour = 10): number {
  const { from, to } = monthRangeIST(ym);
  const last = Math.round((to - from) / DAY);
  return from + (Math.min(day, last) - 1) * DAY + hour * 3600;
}

/** Deterministic offset in [−spread, spread] for month `k` and a per-row salt. */
const wobble = (k: number, salt: number, spread: number) =>
  (((k + 20) * 37 + salt * 53) % (2 * spread + 1)) - spread;

export const loanEmiCents = () => emiFor(LOAN.principal * 100, LOAN.rate, LOAN.tenureMonths);

/** The loan's amortisation schedule in cents (same arithmetic as the loan service). */
export function loanScheduleRows(cal: DemoCalendar) {
  const start = monthAt(cal, LOAN.startOffset);
  return schedule(
    LOAN.principal * 100,
    LOAN.rate,
    LOAN.tenureMonths,
    loanEmiCents(),
    firstEmiDate(start.year, start.month, LOAN.emiDay),
    LOAN.emiDay
  );
}

/** Installment number of the EMI that falls in month offset `k`. */
export const installmentFor = (k: number) => k - LOAN.startOffset + 1;

const E = MYFIN.TRX_TYPES.EXPENSE;
const I = MYFIN.TRX_TYPES.INCOME;
const T = MYFIN.TRX_TYPES.TRANSFER;

/** Every bank and card row, oldest first; rows dated after `now` are left out. */
export function demoTransactions(cal: DemoCalendar): DemoTrx[] {
  const rows: DemoTrx[] = [];
  const emiRupees = loanEmiCents() / 100;
  const cardSpend = new Map<number, number>();

  for (let k = FIRST_OFFSET; k <= 0; k++) {
    const ym = monthAt(cal, k);
    const add = (day: number, row: Omit<DemoTrx, 'date'>, hour = 10) => {
      const date = dayEpoch(ym, day, hour);
      if (date > cal.now) return;
      rows.push({ ...row, date });
      if (row.from === 'card' && row.type === E)
        cardSpend.set(k, (cardSpend.get(k) ?? 0) + row.rupees);
    };
    const spend = (
      day: number,
      description: string,
      rupees: number,
      category: CategoryKey,
      extra: Partial<DemoTrx> = {}
    ) => add(day, { type: E, description, rupees, from: 'salary', category, ...extra });
    const card = (
      day: number,
      description: string,
      rupees: number,
      category: CategoryKey,
      entity?: EntityKey
    ) => add(day, { type: E, description, rupees, from: 'card', category, entity });

    if (k === FIRST_OFFSET) {
      for (const [to, rupees] of [
        ['salary', 85_000],
        ['savings', 150_000],
        ['sinking', 30_000],
      ] as Array<[AccountKey, number]>)
        add(1, { type: I, description: 'Opening balance', rupees, to, adjustment: true }, 0);
    }

    add(1, {
      type: T,
      description: 'Monthly savings',
      rupees: SAVINGS_TRANSFER,
      from: 'salary',
      to: 'savings',
      key: `savings:${k}`,
    });
    add(1, {
      type: T,
      description: 'Sinking fund top-up',
      rupees: SINKING_TRANSFER,
      from: 'salary',
      to: 'sinking',
      key: `sinking:${k}`,
    });
    const lastMonthCard = cardSpend.get(k - 1) ?? 0;
    if (lastMonthCard > 0)
      add(3, {
        type: T,
        description: 'HDFC Credit Card bill payment',
        rupees: lastMonthCard,
        from: 'salary',
        to: 'card',
        entity: 'hdfc',
        key: `cardbill:${k}`,
      });
    add(5, {
      type: E,
      description: 'HDFC HOME LOAN EMI',
      rupees: emiRupees,
      from: 'salary',
      entity: 'hdfc',
      essential: true,
      key: `emi:${k}`,
    });
    add(7, {
      type: T,
      description: 'SIP - Nifty 50 index fund',
      rupees: SIP,
      from: 'salary',
      to: 'invest',
      entity: 'zerodha',
    });

    spend(2, 'Paid to DMART', 2_100 + wobble(k, 1, 4) * 100, 'groceries', {
      entity: 'dmart',
      essential: true,
    });
    spend(8, 'Paid to RELIANCE FRESH', 850 + wobble(k, 2, 5) * 50, 'groceries', {
      entity: 'relianceFresh',
      essential: true,
    });
    spend(14, 'Paid to DMART', 2_400 + wobble(k, 3, 4) * 100, 'groceries', {
      entity: 'dmart',
      essential: true,
    });
    spend(20, 'Paid to SUPPLYCO', 650 + wobble(k, 4, 3) * 50, 'groceries', { essential: true });
    spend(26, 'Paid to RELIANCE FRESH', 1_200 + wobble(k, 5, 6) * 50, 'groceries', {
      entity: 'relianceFresh',
      essential: true,
    });
    for (const day of [4, 11, 18, 23])
      spend(day, 'Paid to CHAI POINT', 120 + wobble(k, day, 3) * 10, 'eatingOut');
    for (const day of [6, 13, 21])
      spend(day, 'Paid to RAJU TEA STALL', 40 + wobble(k, day, 1) * 10, 'eatingOut');
    spend(9, 'Paid to JIO PREPAID', 399, 'mobile', { essential: true });
    spend(12, 'Paid to ACT FIBERNET', 999, 'mobile', { essential: true });
    spend(15, 'Paid to KSEB', 1_800 + wobble(k, 6, 3) * 50, 'utilities', {
      entity: 'kseb',
      essential: true,
    });
    spend(16, 'Paid to INDIAN OIL', 2_500 + wobble(k, 7, 3) * 100, 'fuel', { entity: 'indianOil' });
    if (k % 2 !== 0) spend(19, 'Paid to APOLLO PHARMACY', 650 + wobble(k, 8, 4) * 50, 'health');

    card(10, 'SWIGGY', 520 + wobble(k, 9, 3) * 50, 'eatingOut', 'swiggy');
    card(13, 'AMAZON', 1_600 + wobble(k, 10, 6) * 100, 'shopping', 'amazon');
    card(17, 'ZOMATO', 640 + wobble(k, 11, 3) * 50, 'eatingOut', 'zomato');
    card(19, 'NETFLIX', 649, 'entertainment');
    if (k % 2 === 0) card(22, 'PVR CINEMAS', 700 + wobble(k, 12, 2) * 100, 'entertainment', 'pvr');
    card(24, 'SWIGGY', 480 + wobble(k, 13, 2) * 60, 'eatingOut', 'swiggy');

    // One-offs and the rows the feature step links to debts and yearly costs
    if (k === -2) card(14, 'CROMA - Laptop', LAPTOP, 'shopping', 'croma');
    if (k === -1)
      add(20, {
        type: I,
        description: 'DIWALI BONUS - NIMBUS SOFTWARE',
        rupees: BONUS,
        to: 'salary',
        category: 'bonus',
        entity: 'employer',
        key: 'bonus',
      });
    if (k === -4)
      add(18, {
        type: E,
        description: 'Paid to LIC OF INDIA',
        rupees: LIC_PREMIUM,
        from: 'sinking',
        category: 'insurance',
        entity: 'lic',
        essential: true,
        key: 'lic',
      });
    if (k === -3)
      add(11, {
        type: E,
        description: 'Paid to ARJUN',
        rupees: LENT_TO_ARJUN,
        from: 'salary',
        key: 'arjun:lend',
      });
    if (k === -1)
      add(16, {
        type: I,
        description: 'Received from ARJUN',
        rupees: ARJUN_REPAID,
        to: 'salary',
        key: 'arjun:repay',
      });
    if (k === -5)
      add(9, {
        type: I,
        description: 'Received from MEERA',
        rupees: BORROWED_FROM_MEERA,
        to: 'salary',
        key: 'meera:borrow',
      });
    if (k === -4)
      add(6, {
        type: E,
        description: 'Paid to MEERA',
        rupees: BORROWED_FROM_MEERA,
        from: 'salary',
        key: 'meera:repay',
      });

    // After the cut-off day (25), so it counts in the next month
    add(28, {
      type: I,
      description: 'SALARY - NIMBUS SOFTWARE',
      rupees: SALARY,
      to: 'salary',
      category: 'salary',
      entity: 'employer',
      key: `salary:${k}`,
    });
  }
  return rows.sort((a, b) => a.date - b.date);
}

const NIFTY_NAV0 = 200;
const NIFTY_OPENING = 240_000;
const PPF_OPENING = 150_000;
const PPF_MONTHLY = 0.071 / 12;

const niftyNav = (k: number) =>
  Math.round(NIFTY_NAV0 * 1.009 ** (k - FIRST_OFFSET) * (1 + wobble(k, 14, 15) / 1000) * 100) / 100;
const units = (rupees: number, nav: number) => Math.round((rupees / nav) * 10_000) / 10_000;

/** Investment buys (the opening holdings plus the monthly SIP) and each month's end value. */
export function demoInvestments(cal: DemoCalendar): { buys: DemoBuy[]; values: DemoValue[] } {
  const buys: DemoBuy[] = [];
  const values: DemoValue[] = [];
  const first = monthAt(cal, FIRST_OFFSET);
  const opening = dayEpoch(first, 2);
  if (opening <= cal.now) {
    buys.push({
      asset: 'nifty',
      date: opening,
      rupees: NIFTY_OPENING,
      units: units(NIFTY_OPENING, niftyNav(FIRST_OFFSET)),
      note: 'Opening holding',
    });
    buys.push({
      asset: 'ppf',
      date: opening,
      rupees: PPF_OPENING,
      units: PPF_OPENING,
      note: 'Opening balance',
    });
  }
  let held = buys.find((b) => b.asset === 'nifty')?.units ?? 0;
  for (let k = FIRST_OFFSET; k <= 0; k++) {
    const ym = monthAt(cal, k);
    const sip = dayEpoch(ym, 7);
    if (sip <= cal.now) {
      const u = units(SIP, niftyNav(k));
      buys.push({ asset: 'nifty', date: sip, rupees: SIP, units: u, note: 'SIP' });
      held += u;
    }
    values.push({ asset: 'nifty', ym, rupees: Math.round(held * niftyNav(k)) });
    values.push({
      asset: 'ppf',
      ym,
      rupees: Math.round(PPF_OPENING * (1 + PPF_MONTHLY) ** (k - FIRST_OFFSET + 1)),
    });
  }
  return { buys: buys.sort((a, b) => a.date - b.date), values };
}

const roundUp = (rupees: number, step: number) => Math.ceil(rupees / step) * step;

/**
 * One budget per month of data plus next month. Past months are planned a little above what was
 * spent; the current and next month use the average of the 3 months before the current one.
 */
export function demoBudgets(cal: DemoCalendar, rows: DemoTrx[]): DemoBudget[] {
  const interestByOffset = new Map<number, number>();
  const sched = loanScheduleRows(cal);
  for (let k = FIRST_OFFSET; k <= 1; k++) {
    const row = sched.find((r) => r.n === installmentFor(k));
    if (row) interestByOffset.set(k, row.interest / 100);
  }

  const actual = (k: number) => {
    const { from, to } = monthRangeIST(monthAt(cal, k));
    const out = new Map<CategoryKey, { debit: number; credit: number }>();
    const bump = (c: CategoryKey, debit: number, credit: number) => {
      const v = out.get(c) ?? { debit: 0, credit: 0 };
      out.set(c, { debit: v.debit + debit, credit: v.credit + credit });
    };
    for (const r of rows) {
      if (r.date < from || r.date >= to || r.adjustment || !r.category) continue;
      if (r.type === E) bump(r.category, r.rupees, 0);
      else if (r.type === I) bump(r.category, 0, r.rupees);
    }
    bump('loanInterest', interestByOffset.get(k) ?? 0, 0);
    return out;
  };

  const lines = (m: Map<CategoryKey, { debit: number; credit: number }>) =>
    [...m.entries()]
      .map(([category, v]) => ({
        category,
        debit: v.debit > 0 ? roundUp(v.debit * 1.05, 100) : 0,
        credit: v.credit > 0 ? Math.round(v.credit) : 0,
      }))
      .filter((l) => l.debit > 0 || l.credit > 0);

  const regular = new Map<CategoryKey, { debit: number; credit: number }>();
  for (const k of [-3, -2, -1]) {
    for (const [c, v] of actual(k)) {
      const debit = c === 'shopping' && k === -2 ? v.debit - LAPTOP : v.debit;
      const credit = c === 'bonus' ? 0 : v.credit;
      const acc = regular.get(c) ?? { debit: 0, credit: 0 };
      regular.set(c, { debit: acc.debit + debit / 3, credit: acc.credit + credit / 3 });
    }
  }
  regular.set('salary', { debit: 0, credit: SALARY });

  const notes: Record<number, string> = {
    [-2]: '💻 New laptop',
    [-1]: '🪔 Diwali bonus',
    1: '🚗 Car service',
  };
  const out: DemoBudget[] = [];
  for (let k = FIRST_OFFSET; k <= 1; k++) {
    const base = k < 0 ? actual(k) : new Map(regular);
    if (k >= 0) base.set('loanInterest', { debit: interestByOffset.get(k) ?? 0, credit: 0 });
    out.push({
      ym: monthAt(cal, k),
      isOpen: k >= 0,
      observations: notes[k] ?? '',
      lines: lines(base),
    });
  }
  return out;
}
