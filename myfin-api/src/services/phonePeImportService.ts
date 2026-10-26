import { Prisma } from "@prisma/client";
import { performDatabaseRequest, prisma } from "../config/prisma.js";
import APIError from "../errorHandling/apiError.js";
import ConvertUtils from "../utils/convertUtils.js";
import AccountService from "./accountService.js";
import CategoryService from "./categoryService.js";
import EntityService from "./entityService.js";
import TransactionService, { RuleInstructions } from "./transactionService.js";
import {
  ClassifiedPhonePeRow,
  classifyPhonePeRow,
  instrumentKeysOf,
  parsePhonePeCsv,
} from "./importers/phonePeImporter.js";

const SOURCE = "phonepe";
const CATEGORIZE_CONCURRENCY = 5;

type DbClient = Prisma.TransactionClient;

export type PhonePePreview = {
  instruments: Array<{ key: string; sample_description: string; account_id: bigint | null }>;
  total_rows: number;
  duplicate_rows: number;
  new_rows: number;
};

export type PhonePeCategorizeResult = {
  fillData: Array<RuleInstructions & { external_id: string }>;
  categories: Array<{ category_id: bigint; name: string }>;
  entities: Array<{ entity_id: bigint; name: string }>;
  accounts: Array<{ account_id: bigint; name: string; balance: number }>;
  duplicate_rows: number;
};

/**
 * Returns the subset of `ids` already stored as `transactions.external_id`
 * on a transaction whose from or to account belongs to `userId`.
 */
export async function getExistingExternalIds(
  userId: bigint,
  ids: string[],
  dbClient: DbClient = prisma
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await dbClient.transactions.findMany({
    where: {
      external_id: { in: ids },
      OR: [
        { accounts_transactions_accounts_account_from_idToaccounts: { users_user_id: userId } },
        { accounts_transactions_accounts_account_to_idToaccounts: { users_user_id: userId } },
      ],
    },
    select: { external_id: true },
  });
  return new Set(rows.map((r) => r.external_id));
}

/** Parses + classifies the CSV and splits rows into new ones and duplicates (already imported or repeated in the file). */
const splitRows = async (userId: bigint, csv: string, dbClient: DbClient) => {
  const rows = parsePhonePeCsv(csv).map(classifyPhonePeRow);
  const existing = await getExistingExternalIds(
    userId,
    [...new Set(rows.map((r) => r.externalId))],
    dbClient
  );
  const seen = new Set<string>();
  const newRows: ClassifiedPhonePeRow[] = [];
  for (const row of rows) {
    if (existing.has(row.externalId) || seen.has(row.externalId)) continue;
    seen.add(row.externalId);
    newRows.push(row);
  }
  return { total: rows.length, newRows, duplicates: rows.length - newRows.length };
};

/** Stored key -> account mappings for this user, ignoring any whose account is no longer the user's. */
const getStoredMappings = async (
  userId: bigint,
  keys: string[],
  dbClient: DbClient
): Promise<Map<string, bigint>> => {
  if (keys.length === 0) return new Map();
  const rows = await dbClient.import_instrument_mappings.findMany({
    where: { users_user_id: userId, source: SOURCE, instrument_key: { in: keys } },
    select: { instrument_key: true, accounts_account_id: true, accounts: { select: { users_user_id: true } } },
  });
  return new Map(
    rows
      .filter((r) => r.accounts?.users_user_id === userId)
      .map((r) => [r.instrument_key, r.accounts_account_id])
  );
};

export async function previewPhonePeImport(userId: bigint, csv: string): Promise<PhonePePreview> {
  const { total, newRows, duplicates } = await splitRows(userId, csv, prisma);
  const keys = instrumentKeysOf(newRows);
  const stored = await getStoredMappings(userId, keys, prisma);

  const instruments = keys.map((key) => ({
    key,
    sample_description: newRows.find((r) => r.fromKey === key || r.toKey === key).description,
    account_id: stored.get(key) ?? null,
  }));

  return { instruments, total_rows: total, duplicate_rows: duplicates, new_rows: newRows.length };
}

export async function categorizePhonePeImport(
  userId: bigint,
  csv: string,
  mappings: Array<{ key: string; account_id: bigint }>
): Promise<PhonePeCategorizeResult> {
  const { newRows, duplicates } = await splitRows(userId, csv, prisma);

  // Every requested account must belong to the user
  const requestedAccountIds = [...new Set(mappings.map((m) => BigInt(m.account_id)))];
  if (requestedAccountIds.length > 0) {
    const owned = await prisma.accounts.count({
      where: { users_user_id: userId, account_id: { in: requestedAccountIds } },
    });
    if (owned !== requestedAccountIds.length) throw APIError.notAuthorized();
  }

  // Resolve every key used by a new row: request first, then previously stored mappings
  const keys = instrumentKeysOf(newRows);
  const resolved = await getStoredMappings(userId, keys, prisma);
  for (const m of mappings) resolved.set(m.key, BigInt(m.account_id));
  const unmapped = keys.filter((k) => !resolved.has(k));
  if (unmapped.length > 0) {
    throw APIError.badRequest(`Unmapped payment instruments: ${unmapped.join(", ")}`);
  }

  // Only persist mappings for instruments actually used by this file's new rows
  const usedKeys = new Set(keys);
  const mappingsToSave = mappings.filter((m) => usedKeys.has(m.key));
  await performDatabaseRequest(async (prismaTx) => {
    for (const m of mappingsToSave) {
      const accountId = BigInt(m.account_id);
      await prismaTx.import_instrument_mappings.upsert({
        where: {
          users_user_id_source_instrument_key: {
            users_user_id: userId,
            source: SOURCE,
            instrument_key: m.key,
          },
        },
        create: {
          users_user_id: userId,
          source: SOURCE,
          instrument_key: m.key,
          accounts_account_id: accountId,
        },
        update: { accounts_account_id: accountId },
      });
    }
  });

  // Fetched once; also used as caches for rule matching (same shape as importTransactionsStep1)
  const [categories, entities, accounts] = await Promise.all([
    CategoryService.getAllCategoriesForUser(userId, { category_id: true, name: true }) as Promise<
      Array<{ category_id: bigint; name: string }>
    >,
    EntityService.getAllEntitiesForUser(userId, { entity_id: true, name: true }) as Promise<
      Array<{ entity_id: bigint; name: string }>
    >,
    AccountService.getAccountsForUser(userId, { account_id: true, name: true, current_balance: true }),
  ]);

  // Bounded concurrency so a large statement cannot exhaust the connection pool.
  // Passing the plain `prisma` client makes autoCategorizeTransaction run its (read-only) rule
  // lookup directly instead of opening an interactive transaction per row.
  const fillData: Array<RuleInstructions & { external_id: string }> = [];
  for (let i = 0; i < newRows.length; i += CATEGORIZE_CONCURRENCY) {
    const chunk = newRows.slice(i, i + CATEGORIZE_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (row) => {
        const instructions = await TransactionService.autoCategorizeTransaction(
          userId,
          row.description,
          row.amount,
          row.type,
          row.fromKey ? resolved.get(row.fromKey) : null,
          row.toKey ? resolved.get(row.toKey) : null,
          row.date,
          entities,
          categories,
          prisma
        );
        return { ...instructions, external_id: row.externalId };
      })
    );
    fillData.push(...results);
  }

  return {
    fillData,
    categories,
    entities,
    accounts: accounts.map((acc) => ({
      account_id: acc.account_id,
      name: acc.name,
      balance: ConvertUtils.convertBigIntegerToFloat(acc.current_balance),
    })),
    duplicate_rows: duplicates,
  };
}

export default {
  getExistingExternalIds,
  previewPhonePeImport,
  categorizePhonePeImport,
};
