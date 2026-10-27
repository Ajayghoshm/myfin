import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import { MYFIN } from '../../consts.js';
import { peopleTotals } from '../debts/debtService.js';
import { countsForAnalyticsSql, formatYearMonth, writeOffRowSql } from '../insights/analyticsRules.js';
import { IST_OFFSET_SECONDS, type YearMonth, monthRangeIST, shiftMonth } from '../insights/insightsPrimitives.js';
import { ownershipSql } from '../insights/typicalMonth.js';

/**
 * Net worth (cross-cutting 2) and #17 "net worth change, explained".
 *
 * Net worth at time t = Σ balances of active non-investing accounts (LOANAC / CREAC as they are,
 * negative = owed) from their transactions dated < t, + invest holdings at market value, + money lent
 * still outstanding − money borrowed still outstanding. INVAC balances never count (their holdings do).
 * Historical months use each account's *current* status and type.
 *
 * Invest value at a time: the asset's snapshot for the IST month of (t − 1s), else its latest earlier
 * snapshot. A month's end is monthRangeIST(m).to, clamped to `now` for the current month.
 */

export type NetWorthAt = {
  totalCents: number;
  accounts: { account_id: string; name: string; type: string; cents: number }[];
  investCents: number;
  owedToYouCents: number;
  youOweCents: number;
};

export type NetWorthParts = { saved: number; investment_growth: number; write_offs: number; other: number };

export type NetWorthChange = {
  month: string;
  /** Epoch seconds: the month's start and its (possibly clamped to now) end; drill-downs use them. */
  from: number;
  to: number;
  start: number;
  end: number;
  change: number;
  /** Sum exactly to `change`; anything unexplained is `other`. */
  parts: NetWorthParts;
  /** Informational: Σ over CREAC + LOANAC of (end − start). Overlaps with the parts. */
  debt_paid_down: number;
  /** Non-investing accounts, plus an "investments" line and a "people" (lent − borrowed) line. */
  accounts: { account_id: string; name: string; type: string; start: number; end: number; change: number }[];
  trend: ({ year: number; month: number } & NetWorthParts & { change: number })[];
};

export const INVESTMENTS_LINE_ID = 'investments';
export const PEOPLE_LINE_ID = 'people';
const TREND_MONTHS = 12;
const DEBT_TYPES: string[] = [MYFIN.ACCOUNT_TYPES.CREDIT, MYFIN.ACCOUNT_TYPES.LOAN];

const nowSeconds = () => Math.floor(Date.now() / 1000);
const money = (cents: number) => Math.round(cents) / 100;
/** IST month index of the instant just before `at`. */
const monthIdxBefore = (at: number) => {
  const d = new Date((at - 1 + IST_OFFSET_SECONDS) * 1000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};

type AccountRow = { account_id: bigint; name: string; type: string };

async function netWorthAccounts(userId: bigint): Promise<AccountRow[]> {
  return prisma.accounts.findMany({
    where: {
      users_user_id: userId,
      status: MYFIN.ACCOUNT_STATUS.ACTIVE,
      type: { not: MYFIN.ACCOUNT_TYPES.INVESTING },
    },
    select: { account_id: true, name: true, type: true },
    orderBy: { name: 'asc' },
  });
}

/** `INTERVAL(date, b0, …, bn)`: 0 before b0, k for [b(k−1), b(k)). Boundaries must be non-decreasing. */
const bucketSql = (column: Prisma.Sql, boundaries: number[]) =>
  Prisma.sql`INTERVAL(${column}, ${Prisma.join(boundaries)})`;

/**
 * Balance (cents) of each account at each boundary, from its transactions dated < boundary, with the
 * arithmetic of balance recalculation: an expense, or a transfer out, subtracts; anything else adds.
 */
async function balancesAt(accountIds: bigint[], boundaries: number[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>(accountIds.map((id) => [id.toString(), boundaries.map(() => 0)]));
  if (accountIds.length === 0) return out;
  const last = boundaries[boundaries.length - 1];
  const ids = Prisma.join(accountIds);
  const rows = await prisma.$queryRaw<Array<{ account_id: bigint; bucket: bigint | number; cents: unknown }>>`
    SELECT x.account_id, ${bucketSql(Prisma.sql`x.date_timestamp`, boundaries)} AS bucket, SUM(x.delta) AS cents
    FROM (
      SELECT transactions.accounts_account_from_id AS account_id, transactions.date_timestamp,
             CASE WHEN transactions.type = ${MYFIN.TRX_TYPES.INCOME} THEN transactions.amount ELSE -transactions.amount END AS delta
      FROM transactions
      WHERE transactions.accounts_account_from_id IN (${ids}) AND transactions.date_timestamp < ${last}
      UNION ALL
      SELECT transactions.accounts_account_to_id AS account_id, transactions.date_timestamp,
             CASE WHEN transactions.type = ${MYFIN.TRX_TYPES.EXPENSE} THEN -transactions.amount ELSE transactions.amount END AS delta
      FROM transactions
      WHERE transactions.accounts_account_to_id IN (${ids}) AND transactions.date_timestamp < ${last}
        AND (transactions.accounts_account_from_id IS NULL OR transactions.accounts_account_from_id <> transactions.accounts_account_to_id)
    ) x
    GROUP BY x.account_id, bucket`;
  for (const r of rows) {
    const series = out.get(r.account_id.toString());
    if (!series) continue;
    // A row in bucket j (dated < b(j)) counts at every boundary k ≥ j.
    for (let k = Number(r.bucket); k < boundaries.length; k++) series[k] += Number(r.cents);
  }
  return out;
}

/** Σ invest asset values (cents) at each boundary. */
async function investValuesAt(userId: bigint, boundaries: number[]): Promise<number[]> {
  const maxIdx = Math.max(...boundaries.map(monthIdxBefore));
  const snaps = await prisma.$queryRaw<Array<{ asset_id: bigint; year: number; month: number; current_value: bigint }>>`
    SELECT s.invest_assets_asset_id AS asset_id, s.year, s.month, s.current_value
    FROM invest_asset_evo_snapshot s
    JOIN invest_assets a ON a.asset_id = s.invest_assets_asset_id
    WHERE a.users_user_id = ${userId} AND (s.year * 12 + s.month - 1) <= ${maxIdx}
    ORDER BY s.invest_assets_asset_id, s.year, s.month`;
  const byAsset = new Map<string, { idx: number; cents: number }[]>();
  for (const s of snaps) {
    const list = byAsset.get(s.asset_id.toString()) ?? [];
    list.push({ idx: Number(s.year) * 12 + Number(s.month) - 1, cents: Number(s.current_value) });
    byAsset.set(s.asset_id.toString(), list);
  }
  return boundaries.map((b) => {
    const idx = monthIdxBefore(b);
    let total = 0;
    for (const list of byAsset.values()) {
      let value = 0;
      for (const s of list) {
        if (s.idx > idx) break;
        value = s.cents;
      }
      total += value;
    }
    return total;
  });
}

/** Per-bucket sums (index = INTERVAL bucket) of a signed-cents query over [b0, last). */
function toBuckets(rows: Array<{ bucket: bigint | number; cents: unknown }>, n: number): number[] {
  const out = Array.from({ length: n }, () => 0);
  for (const r of rows) {
    const k = Number(r.bucket);
    if (k >= 0 && k < n) out[k] += Number(r.cents);
  }
  return out;
}

async function totalsAt(userId: bigint, accounts: AccountRow[], boundaries: number[]) {
  const [balances, invest, people] = await Promise.all([
    balancesAt(
      accounts.map((a) => a.account_id),
      boundaries
    ),
    investValuesAt(userId, boundaries),
    Promise.all(boundaries.map((b) => peopleTotals(userId, b))),
  ]);
  const totals = boundaries.map((_, k) => {
    let sum = invest[k] + people[k].owedToYouCents - people[k].youOweCents;
    for (const series of balances.values()) sum += series[k];
    return sum;
  });
  return { balances, invest, people, totals };
}

/** Net worth at `atEpoch` (exclusive), in cents. */
export async function netWorthAt(userId: bigint, atEpoch: number): Promise<NetWorthAt> {
  const accounts = await netWorthAccounts(userId);
  const { balances, invest, people, totals } = await totalsAt(userId, accounts, [atEpoch]);
  return {
    totalCents: totals[0],
    accounts: accounts.map((a) => ({
      account_id: a.account_id.toString(),
      name: a.name,
      type: a.type,
      cents: balances.get(a.account_id.toString())?.[0] ?? 0,
    })),
    investCents: invest[0],
    owedToYouCents: people[0].owedToYouCents,
    youOweCents: people[0].youOweCents,
  };
}

/** This month's net-worth change split into saved / investment growth / write-offs / other, plus a 12-month trend. */
export async function netWorthChange(
  userId: bigint,
  ym: YearMonth,
  now: number = nowSeconds()
): Promise<NetWorthChange> {
  const months = Array.from({ length: TREND_MONTHS }, (_, i) => shiftMonth(ym, i - (TREND_MONTHS - 1)));
  // b0 = first month's start; b(k+1) = month k's end; clamped to now (current / future months)
  const boundaries = [monthRangeIST(months[0]).from, ...months.map((m) => monthRangeIST(m).to)].map((b) =>
    Math.min(b, now)
  );
  const n = boundaries.length;
  const first = boundaries[0];
  const last = boundaries[n - 1];
  const bucket = bucketSql(Prisma.sql`transactions.date_timestamp`, boundaries);

  const accounts = await netWorthAccounts(userId);
  const [{ balances, invest, people, totals }, savedRows, writeOffRows, flowRows] = await Promise.all([
    totalsAt(userId, accounts, boundaries),
    // Saved: counted income − counted spending by calendar IST month (a late salary stays in its month)
    prisma.$queryRaw<Array<{ bucket: bigint; cents: unknown }>>`
      SELECT ${bucket} AS bucket,
             SUM(CASE WHEN transactions.type = ${MYFIN.TRX_TYPES.INCOME} THEN transactions.amount ELSE -transactions.amount END) AS cents
      ${ownershipSql(userId)}
        AND ${countsForAnalyticsSql}
        AND transactions.date_timestamp >= ${first} AND transactions.date_timestamp < ${last}
      GROUP BY bucket`,
    prisma.$queryRaw<Array<{ bucket: bigint; cents: unknown }>>`
      SELECT ${bucket} AS bucket,
             SUM(CASE WHEN transactions.type = ${MYFIN.TRX_TYPES.INCOME} THEN transactions.amount ELSE -transactions.amount END) AS cents
      ${ownershipSql(userId)}
        AND ${writeOffRowSql}
        AND transactions.date_timestamp >= ${first} AND transactions.date_timestamp < ${last}
      GROUP BY bucket`,
    // Net invested: buys − sells (dividend income and cost rows are part of growth)
    prisma.$queryRaw<Array<{ bucket: bigint; cents: unknown }>>`
      SELECT ${bucketSql(Prisma.sql`it.date_timestamp`, boundaries)} AS bucket,
             SUM(CASE WHEN it.type = 'B' THEN it.total_price ELSE -it.total_price END) AS cents
      FROM invest_transactions it
      JOIN invest_assets a ON a.asset_id = it.invest_assets_asset_id
      WHERE a.users_user_id = ${userId} AND it.type IN ('B','S')
        AND it.date_timestamp >= ${first} AND it.date_timestamp < ${last}
      GROUP BY bucket`,
  ]);
  const saved = toBuckets(savedRows, n);
  const writeOffs = toBuckets(writeOffRows, n);
  const flows = toBuckets(flowRows, n);

  // Month k spans [b(k), b(k+1)); its rows are in INTERVAL bucket k+1.
  const partsCents = months.map((_, k) => {
    const change = totals[k + 1] - totals[k];
    const s = saved[k + 1];
    const g = invest[k + 1] - invest[k] - flows[k + 1];
    const w = writeOffs[k + 1];
    return { change, saved: s, growth: g, writeOffs: w, other: change - s - g - w };
  });
  const toParts = (p: (typeof partsCents)[number]): NetWorthParts => ({
    saved: money(p.saved),
    investment_growth: money(p.growth),
    write_offs: money(p.writeOffs),
    other: money(p.other),
  });

  const s = n - 2;
  const e = n - 1;
  const lines: NetWorthChange['accounts'] = [];
  let debtPaidDownCents = 0;
  for (const a of accounts) {
    const series = balances.get(a.account_id.toString()) ?? [];
    const start = series[s] ?? 0;
    const end = series[e] ?? 0;
    if (DEBT_TYPES.includes(a.type)) debtPaidDownCents += end - start;
    if (start === 0 && end === 0) continue;
    lines.push({ account_id: a.account_id.toString(), name: a.name, type: a.type, start: money(start), end: money(end), change: money(end - start) });
  }
  if (invest[s] !== 0 || invest[e] !== 0) {
    lines.push({
      account_id: INVESTMENTS_LINE_ID,
      name: 'Investments',
      type: 'INVEST',
      start: money(invest[s]),
      end: money(invest[e]),
      change: money(invest[e] - invest[s]),
    });
  }
  const peopleNet = (k: number) => people[k].owedToYouCents - people[k].youOweCents;
  if (peopleNet(s) !== 0 || peopleNet(e) !== 0) {
    lines.push({
      account_id: PEOPLE_LINE_ID,
      name: 'Lent and borrowed',
      type: 'PEOPLE',
      start: money(peopleNet(s)),
      end: money(peopleNet(e)),
      change: money(peopleNet(e) - peopleNet(s)),
    });
  }
  lines.sort((x, y) => Math.abs(y.change) - Math.abs(x.change) || x.name.localeCompare(y.name));

  const selected = partsCents[TREND_MONTHS - 1];
  return {
    month: formatYearMonth(ym),
    from: boundaries[s],
    to: boundaries[e],
    start: money(totals[s]),
    end: money(totals[e]),
    change: money(selected.change),
    parts: toParts(selected),
    debt_paid_down: money(debtPaidDownCents),
    accounts: lines,
    trend: months.map((m, k) => ({ year: m.year, month: m.month, ...toParts(partsCents[k]), change: money(partsCents[k].change) })),
  };
}
