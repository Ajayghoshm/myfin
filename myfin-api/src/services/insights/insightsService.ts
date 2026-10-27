import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import { MYFIN } from '../../consts.js';
import {
  type SalaryRule,
  countsForAnalyticsSql,
  cutoffOf,
  effectiveMonthOf,
  formatYearMonth,
  salaryRuleFor,
} from './analyticsRules.js';
import {
  type YearMonth,
  guessIsPerson,
  monthRangeIST,
  payeeKeySql,
  PERSON_PREFIX_SQL,
  shiftMonth,
} from './insightsPrimitives.js';

type Rates = { income: number; spending: number; savings: number; savings_rate: number | null };

export type MonthInsights = {
  month: YearMonth;
  /** 'YYYY-MM' of `month`; figures use the effective-month rule (late salary counts next month). */
  effective_month: string;
  range: { from: number; to: number };
  summary: Rates;
  typical: Rates | null;
  by_category: Array<{ category_id: string | null; name: string | null; amount: number }>;
  merchants: {
    top: Array<{ payee_key: string; amount: number; count: number; average: number }>;
    other_amount: number;
  };
  people: Array<{
    payee_key: string;
    sent: number;
    received: number;
    net: number;
    source: 'guess' | 'user';
  }>;
  biggest_changes: Array<{
    kind: 'category' | 'merchant';
    key: string;
    label: string;
    amount: number;
    typical: number;
    change_pct: number | null;
  }>;
  payment_mix: Array<{ account_id: string; name: string; amount: number }>;
  /** Spending (E rows) split by the category's fixed flag; uncategorised is 'unsorted'. */
  cost_split: CostSplit;
  typical_cost_split: CostSplit | null;
  trend: Array<{
    year: number;
    month: number;
    income: number;
    spending: number;
    fixed: number;
    flexible: number;
    unsorted: number;
    savings_rate: number | null;
  }>;
  one_offs: Array<{
    transaction_id: string;
    payee_key: string;
    amount: number;
    date_timestamp: number;
  }>;
};

export type CostSplit = { fixed: number; flexible: number; unsorted: number };

export type PayeeKind = 'person' | 'merchant';

const TREND_MONTHS = 12;
const BASELINE_MONTHS = 3;
const TOP_MERCHANTS = 10;
const MAX_CHANGES = 5;
/** ₹10,000 in cents. */
const ONE_OFF_MIN_CENTS = 1_000_000;
/** Key must appear in at least this many baseline months to not be a one-off. */
const ONE_OFF_RECURRING_MONTHS = 2;
/** Label of the uncategorised bucket in biggest changes; its key is 'none' (the list filter value). */
const UNCATEGORISED_LABEL = 'Uncategorised';

type Row = {
  id: bigint;
  type: string;
  cents: number;
  date: number;
  categoryId: string | null;
  categoryName: string | null;
  isFixed: boolean;
  fromId: string | null;
  fromName: string | null;
  payeeKey: string;
  monthIdx: number; // 0..TREND_MONTHS-1, last = selected month
};

type RawRow = {
  transaction_id: bigint;
  type: string;
  amount: bigint;
  date_timestamp: bigint;
  category_id: bigint | null;
  category_name: string | null;
  is_fixed: number | boolean | null;
  from_id: bigint | null;
  from_name: string | null;
  payee_key: string | null;
};

const money = (cents: number) => Math.round(cents) / 100;
const rate = (incomeCents: number, spendingCents: number) =>
  incomeCents === 0 ? null : (incomeCents - spendingCents) / incomeCents;

const ownershipSql = (userId: bigint) => Prisma.sql`FROM transactions
  LEFT JOIN accounts acc_from ON acc_from.account_id = transactions.accounts_account_from_id
  LEFT JOIN accounts acc_to ON acc_to.account_id = transactions.accounts_account_to_id
  LEFT JOIN categories ON categories.category_id = transactions.categories_category_id
  WHERE (acc_from.users_user_id = ${userId} OR acc_to.users_user_id = ${userId})`;

/**
 * Counted rows bucketed by effective month. Fetches from the previous month's cut-off so late
 * salaries that belong to the first month are included; rows outside every month are dropped.
 */
async function fetchRows(
  userId: bigint,
  months: YearMonth[],
  ranges: Array<{ from: number; to: number }>,
  rule: SalaryRule
): Promise<Row[]> {
  const from =
    rule.salaryCategoryId == null
      ? ranges[0].from
      : Math.min(ranges[0].from, cutoffOf(shiftMonth(months[0], -1), rule));
  const to = ranges[ranges.length - 1].to;
  const raw = await prisma.$queryRaw<RawRow[]>`
    SELECT transactions.transaction_id,
           transactions.type,
           transactions.amount,
           transactions.date_timestamp,
           transactions.categories_category_id AS category_id,
           categories.name                     AS category_name,
           categories.is_fixed                 AS is_fixed,
           transactions.accounts_account_from_id AS from_id,
           acc_from.name                       AS from_name,
           ${payeeKeySql}                      AS payee_key
    ${ownershipSql(userId)}
      AND ${countsForAnalyticsSql}
      AND transactions.date_timestamp >= ${from} AND transactions.date_timestamp < ${to}`;

  const rows: Row[] = [];
  for (const r of raw) {
    const date = Number(r.date_timestamp);
    const categoryId = r.category_id == null ? null : r.category_id.toString();
    const eff = effectiveMonthOf({ type: r.type, categoryId, date }, rule);
    const monthIdx = months.findIndex((m) => m.year === eff.year && m.month === eff.month);
    if (monthIdx < 0) continue;
    rows.push({
      id: r.transaction_id,
      type: r.type,
      cents: Number(r.amount),
      date,
      categoryId,
      categoryName: r.category_name,
      isFixed: Number(r.is_fixed) === 1,
      fromId: r.from_id == null ? null : r.from_id.toString(),
      fromName: r.from_name,
      payeeKey: r.payee_key ?? '',
      monthIdx,
    });
  }
  return rows;
}

/** Person/merchant kind per key: the user's correction, else the all-history guess. */
async function classifyKeys(
  userId: bigint,
  keys: string[]
): Promise<Map<string, { kind: PayeeKind; source: 'guess' | 'user' }>> {
  const result = new Map<string, { kind: PayeeKind; source: 'guess' | 'user' }>();
  if (keys.length === 0) return result;

  const corrections = await prisma.payee_classifications.findMany({
    where: { users_user_id: userId, payee_key: { in: keys } },
  });
  const corrected = new Map(corrections.map((c) => [c.payee_key, c.kind as PayeeKind]));

  const toGuess = keys.filter((k) => !corrected.has(k));
  const signals = new Map<string, { hasPersonPrefix: boolean; hasRoundPaymentOver1000: boolean }>();
  if (toGuess.length > 0) {
    const raw = await prisma.$queryRaw<
      Array<{ payee_key: string; has_prefix: unknown; has_round: unknown }>
    >`
      SELECT ${payeeKeySql} AS payee_key,
             MAX(${PERSON_PREFIX_SQL}) AS has_prefix,
             MAX(transactions.type = ${MYFIN.TRX_TYPES.EXPENSE}
                 AND transactions.amount >= 100000
                 AND MOD(transactions.amount, 10000) = 0) AS has_round
      ${ownershipSql(userId)}
        AND ${payeeKeySql} IN (${Prisma.join(toGuess)})
      GROUP BY payee_key`;
    for (const r of raw) {
      signals.set(r.payee_key, {
        hasPersonPrefix: Number(r.has_prefix) === 1,
        hasRoundPaymentOver1000: Number(r.has_round) === 1,
      });
    }
  }

  for (const key of keys) {
    const user = corrected.get(key);
    if (user) {
      result.set(key, { kind: user, source: 'user' });
    } else {
      const s = signals.get(key) ?? { hasPersonPrefix: false, hasRoundPaymentOver1000: false };
      result.set(key, { kind: guessIsPerson(key, s) ? 'person' : 'merchant', source: 'guess' });
    }
  }
  return result;
}

const sumBy = <K>(rows: Row[], keyOf: (r: Row) => K) => {
  const out = new Map<K, number>();
  for (const r of rows) {
    const k = keyOf(r);
    out.set(k, (out.get(k) ?? 0) + r.cents);
  }
  return out;
};

const splitCents = (rows: Row[]) => {
  let fixed = 0;
  let flexible = 0;
  let unsorted = 0;
  for (const r of rows) {
    if (r.type !== MYFIN.TRX_TYPES.EXPENSE) continue;
    if (r.categoryId == null) unsorted += r.cents;
    else if (r.isFixed) fixed += r.cents;
    else flexible += r.cents;
  }
  return { fixed, flexible, unsorted };
};
const toSplit = (c: { fixed: number; flexible: number; unsorted: number }, n = 1): CostSplit => ({
  fixed: money(c.fixed / n),
  flexible: money(c.flexible / n),
  unsorted: money(c.unsorted / n),
});

const isE = (r: Row) => r.type === MYFIN.TRX_TYPES.EXPENSE;
const isI = (r: Row) => r.type === MYFIN.TRX_TYPES.INCOME;
const total = (rows: Row[]) => rows.reduce((s, r) => s + r.cents, 0);

export async function getMonthInsights(userId: bigint, ym: YearMonth): Promise<MonthInsights> {
  const months = Array.from({ length: TREND_MONTHS }, (_, i) =>
    shiftMonth(ym, i - (TREND_MONTHS - 1))
  );
  const ranges = months.map(monthRangeIST);
  const sel = TREND_MONTHS - 1;
  const baselineIdx = Array.from({ length: BASELINE_MONTHS }, (_, i) => sel - BASELINE_MONTHS + i);

  const rule = await salaryRuleFor(userId);
  const rows = await fetchRows(userId, months, ranges, rule);
  const current = rows.filter((r) => r.monthIdx === sel);
  const baseline = rows.filter((r) => baselineIdx.includes(r.monthIdx));

  // Summary (raw)
  const incomeC = total(current.filter(isI));
  const spendingC = total(current.filter(isE));
  const summary: Rates = {
    income: money(incomeC),
    spending: money(spendingC),
    savings: money(incomeC - spendingC),
    savings_rate: rate(incomeC, spendingC),
  };

  // One-offs (baseline only)
  const monthsByKey = new Map<string, Set<number>>();
  for (const r of baseline) {
    if (!r.payeeKey) continue;
    const seen = monthsByKey.get(r.payeeKey) ?? new Set<number>();
    seen.add(r.monthIdx);
    monthsByKey.set(r.payeeKey, seen);
  }
  const oneOffRows = baseline.filter(
    (r) =>
      isE(r) &&
      r.cents >= ONE_OFF_MIN_CENTS &&
      r.payeeKey !== '' &&
      (monthsByKey.get(r.payeeKey)?.size ?? 0) < ONE_OFF_RECURRING_MONTHS
  );
  const oneOffIds = new Set(oneOffRows.map((r) => r.id));
  const baselineClean = baseline.filter((r) => !oneOffIds.has(r.id));

  // Typical month: average over baseline months that have data
  const baselineN = new Set(baseline.map((r) => r.monthIdx)).size;
  let typical: Rates | null = null;
  if (baselineN > 0) {
    const tInc = total(baselineClean.filter(isI)) / baselineN;
    const tSpend = total(baselineClean.filter(isE)) / baselineN;
    typical = {
      income: money(tInc),
      spending: money(tSpend),
      savings: money(tInc - tSpend),
      savings_rate: rate(tInc, tSpend),
    };
  }

  const cost_split = toSplit(splitCents(current));
  const typical_cost_split = baselineN > 0 ? toSplit(splitCents(baselineClean), baselineN) : null;

  // Categories (spending)
  const catNames = new Map<string | null, string | null>();
  for (const r of rows) catNames.set(r.categoryId, r.categoryName);
  const currentE = current.filter(isE);
  const by_category = [...sumBy(currentE, (r) => r.categoryId).entries()]
    .map(([id, cents]) => ({ id, cents }))
    .sort((a, b) => b.cents - a.cents || String(a.id).localeCompare(String(b.id)))
    .map(({ id, cents }) => ({
      category_id: id,
      name: catNames.get(id) ?? null,
      amount: money(cents),
    }));

  // Classify non-empty keys of the selected and baseline months
  const keys = [
    ...new Set([...current, ...baseline].map((r) => r.payeeKey).filter((k) => k !== '')),
  ];
  const kinds = await classifyKeys(userId, keys);
  const kindOf = (k: string) => kinds.get(k)?.kind;

  // Merchants
  const merchantRows = currentE.filter(
    (r) => r.payeeKey !== '' && kindOf(r.payeeKey) === 'merchant'
  );
  const merchantAgg = new Map<string, { cents: number; count: number }>();
  for (const r of merchantRows) {
    const m = merchantAgg.get(r.payeeKey) ?? { cents: 0, count: 0 };
    m.cents += r.cents;
    m.count += 1;
    merchantAgg.set(r.payeeKey, m);
  }
  const merchantsSorted = [...merchantAgg.entries()].sort(
    (a, b) => b[1].cents - a[1].cents || a[0].localeCompare(b[0])
  );
  const merchants = {
    top: merchantsSorted.slice(0, TOP_MERCHANTS).map(([key, m]) => ({
      payee_key: key,
      amount: money(m.cents),
      count: m.count,
      average: money(m.cents / m.count),
    })),
    other_amount: money(merchantsSorted.slice(TOP_MERCHANTS).reduce((s, [, m]) => s + m.cents, 0)),
  };

  // People
  const peopleAgg = new Map<string, { sent: number; received: number }>();
  for (const r of current) {
    if (r.payeeKey === '' || kindOf(r.payeeKey) !== 'person') continue;
    const p = peopleAgg.get(r.payeeKey) ?? { sent: 0, received: 0 };
    if (isE(r)) p.sent += r.cents;
    else p.received += r.cents;
    peopleAgg.set(r.payeeKey, p);
  }
  const people = [...peopleAgg.entries()]
    .sort(
      (a, b) => b[1].sent + b[1].received - (a[1].sent + a[1].received) || a[0].localeCompare(b[0])
    )
    .map(([key, p]) => ({
      payee_key: key,
      sent: money(p.sent),
      received: money(p.received),
      net: money(p.received - p.sent),
      source: kinds.get(key)?.source ?? 'guess',
    }));

  // Biggest changes (categories and merchants, one-offs excluded from the baseline)
  const biggest_changes: MonthInsights['biggest_changes'] = [];
  if (baselineN > 0) {
    const baseE = baselineClean.filter(isE);
    type Cand = MonthInsights['biggest_changes'][number] & { cur: number; typ: number };
    const cands: Cand[] = [];
    const add = (
      kind: 'category' | 'merchant',
      key: string,
      label: string,
      cur: number,
      typ: number
    ) => {
      if (Math.round(cur - typ) === 0) return;
      cands.push({
        kind,
        key,
        label,
        amount: money(cur),
        typical: money(typ),
        change_pct: typ === 0 ? null : (cur - typ) / typ,
        cur,
        typ,
      });
    };
    const curCat = sumBy(currentE, (r) => r.categoryId);
    const baseCat = sumBy(baseE, (r) => r.categoryId);
    for (const id of new Set([...curCat.keys(), ...baseCat.keys()])) {
      add(
        'category',
        id ?? 'none',
        id == null ? UNCATEGORISED_LABEL : (catNames.get(id) ?? ''),
        curCat.get(id) ?? 0,
        (baseCat.get(id) ?? 0) / baselineN
      );
    }
    const isMerchant = (r: Row) => r.payeeKey !== '' && kindOf(r.payeeKey) === 'merchant';
    const curM = sumBy(currentE.filter(isMerchant), (r) => r.payeeKey);
    const baseM = sumBy(baseE.filter(isMerchant), (r) => r.payeeKey);
    for (const key of new Set([...curM.keys(), ...baseM.keys()])) {
      add('merchant', key, key, curM.get(key) ?? 0, (baseM.get(key) ?? 0) / baselineN);
    }
    const ranked = [...cands]
      .sort(
        (a, b) =>
          Math.abs(b.cur - b.typ) - Math.abs(a.cur - a.typ) ||
          a.kind.localeCompare(b.kind) ||
          a.key.localeCompare(b.key)
      )
      .slice(0, MAX_CHANGES);
    for (const { cur: _c, typ: _t, ...c } of ranked) biggest_changes.push(c);
  }

  // Payment mix: spending by source account
  const accNames = new Map<string, string>();
  for (const r of currentE) if (r.fromId) accNames.set(r.fromId, r.fromName ?? '');
  const payment_mix = [
    ...sumBy(
      currentE.filter((r) => r.fromId != null),
      (r) => r.fromId ?? ''
    ).entries(),
  ]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, cents]) => ({ account_id: id, name: accNames.get(id) ?? '', amount: money(cents) }));

  // Trend (raw)
  const trend = months.map((m, i) => {
    const monthRows = rows.filter((r) => r.monthIdx === i);
    const inc = total(monthRows.filter(isI));
    const sp = total(monthRows.filter(isE));
    return {
      year: m.year,
      month: m.month,
      income: money(inc),
      spending: money(sp),
      ...toSplit(splitCents(monthRows)),
      savings_rate: rate(inc, sp),
    };
  });

  const one_offs = oneOffRows
    .sort((a, b) => a.date - b.date)
    .map((r) => ({
      transaction_id: r.id.toString(),
      payee_key: r.payeeKey,
      amount: money(r.cents),
      date_timestamp: r.date,
    }));

  return {
    month: { year: ym.year, month: ym.month },
    effective_month: formatYearMonth(ym),
    range: ranges[sel],
    summary,
    typical,
    by_category,
    merchants,
    people,
    biggest_changes,
    payment_mix,
    cost_split,
    typical_cost_split,
    trend,
    one_offs,
  };
}

export async function setPayeeClassification(
  userId: bigint,
  payeeKey: string,
  kind: PayeeKind | null
): Promise<void> {
  if (kind === null) {
    await prisma.payee_classifications.deleteMany({
      where: { users_user_id: userId, payee_key: payeeKey },
    });
    return;
  }
  if (kind !== 'person' && kind !== 'merchant') throw new Error(`Invalid payee kind: ${kind}`);
  await prisma.payee_classifications.upsert({
    where: { users_user_id_payee_key: { users_user_id: userId, payee_key: payeeKey } },
    create: { users_user_id: userId, payee_key: payeeKey, kind },
    update: { kind },
  });
}

export default { getMonthInsights, setPayeeClassification };
