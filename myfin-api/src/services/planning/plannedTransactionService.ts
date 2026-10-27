import { Prisma } from '../../generated/prisma/client.js';
import { performDatabaseRequest, prisma } from '../../config/prisma.js';
import APIError from '../../errorHandling/apiError.js';
import ConvertUtils from '../../utils/convertUtils.js';
import TransactionService from '../transactionService.js';

const DAY = 86_400;
/** A real transaction matches a planned one within 7 days and ₹1 (100 cents). */
const MATCH_DAYS = 7;
const MATCH_CENTS = 100;

export type PlannedInput = {
  date_timestamp: number | bigint;
  /** Cents. */
  amount: number | bigint;
  type: string;
  account_from_id?: bigint | null;
  account_to_id?: bigint | null;
  category_id?: bigint | null;
  description: string;
  salary_plan_id?: bigint | null;
  bucket?: string | null;
  created_at?: number | bigint;
};

export type PlannedRow = {
  planned_id: string;
  date_timestamp: number;
  amount: number;
  type: string;
  account_from_id: string | null;
  account_to_id: string | null;
  category_id: string | null;
  description: string;
  salary_plan_id: string | null;
  bucket: string | null;
  created_at: number;
};

type Tx = Prisma.TransactionClient;
type PlannedDb = Prisma.planned_transactionsGetPayload<object>;
type ResolveOutcome = 'done' | 'skipped';
type ResolvedHandler = (
  plannedId: bigint,
  outcome: ResolveOutcome,
  transactionId: bigint | null,
  prismaTx: Tx
) => Promise<void>;

let resolvedHandler: ResolvedHandler = async () => {};

/** Task 7 registers its handler here (the default is a no-op). */
export function setOnPlannedResolved(fn: ResolvedHandler) {
  resolvedHandler = fn;
}

export const onPlannedResolved: ResolvedHandler = (plannedId, outcome, transactionId, prismaTx) =>
  resolvedHandler(plannedId, outcome, transactionId, prismaTx);

const idStr = (v: bigint | null) => (v == null ? null : v.toString());

const toDto = (r: PlannedDb): PlannedRow => ({
  planned_id: r.planned_id.toString(),
  date_timestamp: Number(r.date_timestamp),
  amount: ConvertUtils.convertBigIntegerToFloat(r.amount),
  type: r.type,
  account_from_id: idStr(r.accounts_account_from_id),
  account_to_id: idStr(r.accounts_account_to_id),
  category_id: idStr(r.categories_category_id),
  description: r.description,
  salary_plan_id: idStr(r.salary_plan_id),
  bucket: r.bucket,
  created_at: Number(r.created_at),
});

/** Inserts planned rows (amounts in cents). Never touches balances. Returns the new ids in input order. */
export async function createPlanned(userId: bigint, rows: PlannedInput[], prismaTx: Tx): Promise<bigint[]> {
  const accountIds = [
    ...new Set(rows.flatMap((r) => [r.account_from_id, r.account_to_id]).filter((a): a is bigint => a != null)),
  ];
  if (accountIds.length > 0) {
    const owned = await prismaTx.accounts.count({ where: { account_id: { in: accountIds }, users_user_id: userId } });
    if (owned !== accountIds.length) throw APIError.notAuthorized();
  }
  const now = Math.floor(Date.now() / 1000);
  const ids: bigint[] = [];
  for (const r of rows) {
    const created = await prismaTx.planned_transactions.create({
      data: {
        users_user_id: userId,
        date_timestamp: BigInt(r.date_timestamp),
        amount: BigInt(r.amount),
        type: r.type,
        accounts_account_from_id: r.account_from_id ?? null,
        accounts_account_to_id: r.account_to_id ?? null,
        categories_category_id: r.category_id ?? null,
        description: r.description.slice(0, 255),
        salary_plan_id: r.salary_plan_id ?? null,
        bucket: r.bucket ?? null,
        created_at: BigInt(r.created_at ?? now),
      },
    });
    ids.push(created.planned_id);
  }
  return ids;
}

export async function listPlanned(userId: bigint): Promise<PlannedRow[]> {
  const rows = await prisma.planned_transactions.findMany({
    where: { users_user_id: userId },
    orderBy: [{ date_timestamp: 'asc' }, { planned_id: 'asc' }],
  });
  return rows.map(toDto);
}

async function loadOwned(userId: bigint, plannedId: bigint, db: Tx | typeof prisma): Promise<PlannedDb> {
  const row = await db.planned_transactions.findUnique({ where: { planned_id: plannedId } });
  if (!row) throw APIError.notFound('Planned transaction not found');
  if (row.users_user_id !== userId) throw APIError.notAuthorized();
  return row;
}

/** Deletes the row; fails if someone else resolved it first. */
async function removePlanned(userId: bigint, plannedId: bigint, prismaTx: Tx) {
  const res = await prismaTx.planned_transactions.deleteMany({
    where: { planned_id: plannedId, users_user_id: userId },
  });
  if (res.count !== 1) throw APIError.notFound('Planned transaction not found');
}

/** Creates the real transaction (balances recalculated) and removes the planned row. Returns the new transaction id. */
export async function markDone(
  userId: bigint,
  plannedId: bigint,
  now: number = Math.floor(Date.now() / 1000)
): Promise<bigint> {
  return performDatabaseRequest(async (prismaTx) => {
    const planned = await loadOwned(userId, plannedId, prismaTx);
    await removePlanned(userId, plannedId, prismaTx);
    const trx = await TransactionService.createTransaction(
      userId,
      {
        amount: ConvertUtils.convertBigIntegerToFloat(planned.amount),
        type: planned.type,
        description: planned.description,
        account_from_id: planned.accounts_account_from_id ?? undefined,
        account_to_id: planned.accounts_account_to_id ?? undefined,
        category_id: planned.categories_category_id ?? undefined,
        // A plan for a future date that is done today happened today
        date_timestamp: Math.min(Number(planned.date_timestamp), now),
        is_essential: false,
      },
      prismaTx
    );
    await onPlannedResolved(plannedId, 'done', trx.transaction_id, prismaTx);
    return trx.transaction_id as bigint;
  });
}

export async function skip(userId: bigint, plannedId: bigint): Promise<void> {
  await performDatabaseRequest(async (prismaTx) => {
    await loadOwned(userId, plannedId, prismaTx);
    await removePlanned(userId, plannedId, prismaTx);
    await onPlannedResolved(plannedId, 'skipped', null, prismaTx);
  });
}

type TrxLike = {
  transaction_id: bigint;
  type: string;
  amount: bigint;
  date_timestamp: bigint;
  accounts_account_from_id: bigint | null;
  accounts_account_to_id: bigint | null;
};

const sameAccount = (a: bigint | null, b: bigint | null) => (a ?? null) === (b ?? null);

function isMatch(planned: PlannedDb, trx: TrxLike): boolean {
  return (
    planned.type === trx.type &&
    sameAccount(planned.accounts_account_from_id, trx.accounts_account_from_id) &&
    sameAccount(planned.accounts_account_to_id, trx.accounts_account_to_id) &&
    Math.abs(Number(planned.amount) - Number(trx.amount)) <= MATCH_CENTS &&
    Math.abs(Number(planned.date_timestamp) - Number(trx.date_timestamp)) <= MATCH_DAYS * DAY
  );
}

const distance = (planned: PlannedDb, trx: TrxLike) =>
  Math.abs(Number(planned.amount) - Number(trx.amount)) * DAY +
  Math.abs(Number(planned.date_timestamp) - Number(trx.date_timestamp));

const ownedTrxWhere = (userId: bigint): Prisma.transactionsWhereInput => ({
  OR: [
    { accounts_transactions_accounts_account_from_idToaccounts: { users_user_id: userId } },
    { accounts_transactions_accounts_account_to_idToaccounts: { users_user_id: userId } },
  ],
});

/** Read-only: for each given transaction, the planned row it looks like (each planned row is offered once). */
export async function findMatches(
  userId: bigint,
  transactionIds: bigint[]
): Promise<{ transaction_id: string; planned: PlannedRow }[]> {
  if (transactionIds.length === 0) return [];
  const [trxs, planned] = await Promise.all([
    prisma.transactions.findMany({
      where: { transaction_id: { in: transactionIds }, ...ownedTrxWhere(userId) },
      orderBy: { transaction_id: 'asc' },
    }),
    prisma.planned_transactions.findMany({ where: { users_user_id: userId } }),
  ]);
  const taken = new Set<string>();
  const out: { transaction_id: string; planned: PlannedRow }[] = [];
  for (const trx of trxs) {
    const best = planned
      .filter((p) => !taken.has(p.planned_id.toString()) && isMatch(p, trx))
      .sort((a, b) => distance(a, trx) - distance(b, trx) || Number(a.planned_id - b.planned_id))[0];
    if (!best) continue;
    taken.add(best.planned_id.toString());
    out.push({ transaction_id: trx.transaction_id.toString(), planned: toDto(best) });
  }
  return out;
}

export type MatchCandidate = {
  transaction_id: string;
  date_timestamp: number;
  amount: number;
  type: string;
  description: string;
};

/** Read-only: the user's real transactions that match one planned row. */
export async function candidatesFor(userId: bigint, plannedId: bigint): Promise<MatchCandidate[]> {
  const planned = await loadOwned(userId, plannedId, prisma);
  const trxs = await prisma.transactions.findMany({
    where: {
      type: planned.type,
      accounts_account_from_id: planned.accounts_account_from_id,
      accounts_account_to_id: planned.accounts_account_to_id,
      amount: { gte: planned.amount - BigInt(MATCH_CENTS), lte: planned.amount + BigInt(MATCH_CENTS) },
      date_timestamp: {
        gte: planned.date_timestamp - BigInt(MATCH_DAYS * DAY),
        lte: planned.date_timestamp + BigInt(MATCH_DAYS * DAY),
      },
      ...ownedTrxWhere(userId),
    },
  });
  return trxs
    .filter((t) => isMatch(planned, t))
    .sort((a, b) => distance(planned, a) - distance(planned, b))
    .map((t) => ({
      transaction_id: t.transaction_id.toString(),
      date_timestamp: Number(t.date_timestamp),
      amount: ConvertUtils.convertBigIntegerToFloat(t.amount),
      type: t.type,
      description: t.description,
    }));
}

/** User confirmed: keep the real transaction, drop the planned row (re-validated first). */
export async function confirmMatch(userId: bigint, plannedId: bigint, transactionId: bigint): Promise<void> {
  await performDatabaseRequest(async (prismaTx) => {
    const planned = await loadOwned(userId, plannedId, prismaTx);
    const trx = await prismaTx.transactions.findFirst({
      where: { transaction_id: transactionId, ...ownedTrxWhere(userId) },
    });
    if (!trx) throw APIError.notAuthorized();
    if (!isMatch(planned, trx)) throw APIError.badRequest('This transaction does not match the planned one');
    await removePlanned(userId, plannedId, prismaTx);
    await onPlannedResolved(plannedId, 'done', transactionId, prismaTx);
  });
}

export default {
  createPlanned,
  listPlanned,
  markDone,
  skip,
  findMatches,
  candidatesFor,
  confirmMatch,
  setOnPlannedResolved,
  onPlannedResolved,
};
