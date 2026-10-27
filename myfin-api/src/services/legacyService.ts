import { prisma } from '../config/prisma.js';
import APIError from '../errorHandling/apiError.js';
import { listAccountsWithFreshness } from './accountFreshnessService.js';
import { listLoans } from './debts/loanService.js';
import { listDebts } from './debts/debtService.js';
import { countsForAnalyticsSql } from './insights/analyticsRules.js';
import { monthRangeIST, payeeKeySql, shiftMonth } from './insights/insightsPrimitives.js';
import { ownershipSql } from './insights/typicalMonth.js';
import ConvertUtils from '../utils/convertUtils.js';

export type LegacyKind = 'account' | 'policy' | 'contact' | 'instruction';

export type LegacyInput = {
  kind: LegacyKind;
  account_id?: string | number | null;
  data: Record<string, unknown>;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);
const INSURER_WORDS = /INSURANCE|LIFE|HEALTH|POLICY|ASSURANCE|\bLIC\b/;

type EntryRow = Awaited<ReturnType<typeof prisma.legacy_entries.findFirstOrThrow>>;

const toDto = (e: EntryRow) => ({
  entry_id: String(e.entry_id),
  kind: e.kind as LegacyKind,
  account_id: e.account_id == null ? null : String(e.account_id),
  data: e.data as Record<string, unknown>,
  sort_order: e.sort_order,
  created_at: Number(e.created_at),
  updated_at: Number(e.updated_at),
});

async function ownedEntry(userId: bigint, entryId: bigint) {
  const entry = await prisma.legacy_entries.findFirst({ where: { entry_id: entryId, users_user_id: userId } });
  if (!entry) throw APIError.notAuthorized();
  return entry;
}

async function checkAccount(userId: bigint, kind: LegacyKind, accountId: bigint | null, exceptEntry?: bigint) {
  if (kind !== 'account') return;
  if (accountId == null) throw APIError.badRequest('An account entry needs an account');
  const account = await prisma.accounts.findFirst({ where: { account_id: accountId, users_user_id: userId } });
  if (!account) throw APIError.notAuthorized();
  const duplicate = await prisma.legacy_entries.findFirst({
    where: {
      users_user_id: userId,
      kind: 'account',
      account_id: accountId,
      ...(exceptEntry ? { entry_id: { not: exceptEntry } } : {}),
    },
  });
  if (duplicate) throw APIError.badRequest('This account already has an entry');
}

export async function createEntry(userId: bigint, input: LegacyInput) {
  const accountId = input.kind === 'account' && input.account_id != null ? BigInt(input.account_id) : null;
  await checkAccount(userId, input.kind, accountId);
  const now = nowSeconds();
  const last = await prisma.legacy_entries.aggregate({ where: { users_user_id: userId }, _max: { sort_order: true } });
  const row = await prisma.legacy_entries.create({
    data: {
      users_user_id: userId,
      kind: input.kind,
      account_id: accountId,
      data: input.data as object,
      sort_order: (last._max.sort_order ?? -1) + 1,
      created_at: BigInt(now),
      updated_at: BigInt(now),
    },
  });
  return toDto(row);
}

/** The kind and account of an entry never change; only its data does. */
export async function updateEntry(userId: bigint, entryId: bigint, data: Record<string, unknown>) {
  await ownedEntry(userId, entryId);
  const row = await prisma.legacy_entries.update({
    where: { entry_id: entryId },
    data: { data: data as object, updated_at: BigInt(nowSeconds()) },
  });
  return toDto(row);
}

export async function deleteEntry(userId: bigint, entryId: bigint) {
  await ownedEntry(userId, entryId);
  await prisma.legacy_entries.delete({ where: { entry_id: entryId } });
}

export async function ownedEntryKind(userId: bigint, entryId: bigint): Promise<LegacyKind> {
  return (await ownedEntry(userId, entryId)).kind as LegacyKind;
}

type SuggestionRow = { payee_key: string; amount: bigint; date_timestamp: bigint };

/** Insurer-like payees paid in the last 13 months that no policy entry names yet. */
export async function policySuggestions(
  userId: bigint,
  insurers: string[],
  now: number = nowSeconds()
): Promise<Array<{ payee_key: string; last_amount: number; last_date: number }>> {
  const d = new Date((now + 19800) * 1000);
  const from = monthRangeIST(shiftMonth({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }, -12)).from;
  const rows = await prisma.$queryRaw<SuggestionRow[]>`
    SELECT ${payeeKeySql} AS payee_key, transactions.amount AS amount, transactions.date_timestamp AS date_timestamp
    ${ownershipSql(userId)}
      AND transactions.type = 'E'
      AND ${payeeKeySql} REGEXP 'INSURANCE|LIFE|HEALTH|POLICY|ASSURANCE|\\bLIC\\b'
      AND ${countsForAnalyticsSql}
      AND transactions.date_timestamp >= ${from}
    ORDER BY transactions.date_timestamp DESC, transactions.transaction_id DESC`;
  const known = insurers.map((i) => i.trim().toUpperCase()).filter(Boolean);
  const seen = new Map<string, { payee_key: string; last_amount: number; last_date: number }>();
  for (const r of rows) {
    const key = r.payee_key;
    if (!key || seen.has(key) || !INSURER_WORDS.test(key)) continue;
    if (known.some((k) => key.includes(k) || k.includes(key))) continue;
    seen.set(key, {
      payee_key: key,
      last_amount: ConvertUtils.convertBigIntegerToFloat(BigInt(r.amount)),
      last_date: Number(r.date_timestamp),
    });
  }
  return [...seen.values()];
}

/** Entries plus the live parts: account balances, loans and people debts, and policy suggestions. */
export async function getLegacy(userId: bigint, now: number = nowSeconds()) {
  const rows = await prisma.legacy_entries.findMany({
    where: { users_user_id: userId },
    orderBy: [{ sort_order: 'asc' }, { entry_id: 'asc' }],
  });
  const entries = rows.map(toDto);
  const liveAccounts = (await listAccountsWithFreshness(userId, now)) as unknown as Array<{
    account_id: bigint;
    name: string;
    type: string;
    status: string;
    balance?: number | null;
  }>;
  const accounts = liveAccounts.map((a) => ({
    account_id: String(a.account_id),
    name: a.name,
    type: a.type,
    status: a.status,
    balance: Number(a.balance ?? 0),
  }));
  const [loans, people] = await Promise.all([listLoans(userId, now), listDebts(userId, now)]);
  const insurers = entries
    .filter((e) => e.kind === 'policy')
    .map((e) => String(e.data.insurer ?? ''));
  return {
    entries,
    accounts,
    debts: {
      loans: loans
        .filter((l) => l.status !== 'settled')
        .map(({ schedule: _schedule, ...loan }) => loan),
      people: people.debts.filter((d) => d.kind !== 'loan' && d.status !== 'settled'),
      totals: people.totals,
    },
    suggestions: await policySuggestions(userId, insurers, now),
  };
}
