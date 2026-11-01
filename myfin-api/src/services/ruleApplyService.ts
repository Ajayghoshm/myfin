import { performDatabaseRequest, prisma } from '../config/prisma.js';
import { MYFIN } from '../consts.js';
import ConvertUtils from '../utils/convertUtils.js';
import CategoryService from './categoryService.js';
import EntityService from './entityService.js';
import RuleService from './ruleService.js';

export type RuleChange = {
  transaction_id: string;
  date: number;
  description: string;
  amount: number;
  rule_id: string;
  current_category_id: string | null;
  new_category_id: string | null;
  current_entity_id: string | null;
  new_entity_id: string | null;
};

const MAX_CHANGES = 2000;
const PAGE_SIZE = 500;
const MATCH_CONCURRENCY = 5;

type Row = {
  transaction_id: bigint;
  date_timestamp: bigint;
  amount: bigint;
  type: string;
  description: string | null;
  entities_entity_id: bigint | null;
  accounts_account_from_id: bigint | null;
  accounts_account_to_id: bigint | null;
  categories_category_id: bigint | null;
  is_essential: boolean;
};

const rowSelect = {
  transaction_id: true,
  date_timestamp: true,
  amount: true,
  type: true,
  description: true,
  entities_entity_id: true,
  accounts_account_from_id: true,
  accounts_account_to_id: true,
  categories_category_id: true,
  is_essential: true,
} as const;

// Only the user's own plain transactions: never transfers, adjustments or debt bookkeeping
const eligibleWhere = (userId: bigint) => ({
  type: { not: MYFIN.TRX_TYPES.TRANSFER },
  is_adjustment: false,
  debt_id: null,
  OR: [
    { accounts_transactions_accounts_account_from_idToaccounts: { users_user_id: userId } },
    { accounts_transactions_accounts_account_to_idToaccounts: { users_user_id: userId } },
  ],
});

type Caches = {
  entities: Array<{ entity_id: bigint; name: string }>;
  categories: Array<{ category_id: bigint; name: string }>;
};

const loadCaches = async (userId: bigint): Promise<Caches> => ({
  entities: (await EntityService.getAllEntitiesForUser(userId, { entity_id: true, name: true })) as Caches['entities'],
  categories: (await CategoryService.getAllCategoriesForUser(userId, {
    category_id: true,
    name: true,
  })) as Caches['categories'],
});

// Same matching as import time; the plain prisma client keeps the rule lookup read-only and light
const matchRow = (userId: bigint, row: Row, caches: Caches) =>
  RuleService.getRuleForTransaction(
    userId,
    row.description ?? '',
    ConvertUtils.convertBigIntegerToFloat(row.amount),
    row.type,
    row.accounts_account_from_id,
    row.accounts_account_to_id,
    MYFIN.RULES.MATCHING.IGNORE,
    MYFIN.RULES.MATCHING.IGNORE,
    caches.entities,
    caches.categories,
    prisma
  );

// The category/entity/essential values the rule would write that differ from the stored ones
const diffOf = (
  row: Row,
  rule: {
    assign_category_id?: bigint | number | null;
    assign_entity_id?: bigint | number | null;
    assign_is_essential?: boolean | null;
  }
) => {
  const data: { categories_category_id?: bigint; entities_entity_id?: bigint; is_essential?: boolean } = {};
  if (rule.assign_category_id != null && BigInt(rule.assign_category_id) !== row.categories_category_id)
    data.categories_category_id = BigInt(rule.assign_category_id);
  if (rule.assign_entity_id != null && BigInt(rule.assign_entity_id) !== row.entities_entity_id)
    data.entities_entity_id = BigInt(rule.assign_entity_id);
  // A rule's essential flag defaults to false, so only an explicit true is treated as an assignment
  if (rule.assign_is_essential === true && !row.is_essential) data.is_essential = true;
  return data;
};

const idOrNull = (id: bigint | null | undefined) => (id == null ? null : String(id));

/** Lists the transactions whose category or entity the current ruleset would change. Writes nothing. */
export async function previewRuleApplication(userId: bigint): Promise<{ changes: RuleChange[]; truncated: boolean }> {
  const caches = await loadCaches(userId);
  const changes: RuleChange[] = [];
  let cursor: bigint | undefined;

  for (;;) {
    const page: Row[] = await prisma.transactions.findMany({
      where: eligibleWhere(userId),
      select: rowSelect,
      orderBy: { transaction_id: 'desc' },
      take: PAGE_SIZE,
      ...(cursor !== undefined ? { cursor: { transaction_id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].transaction_id;

    // Bounded concurrency so a large history cannot exhaust the connection pool
    for (let i = 0; i < page.length; i += MATCH_CONCURRENCY) {
      const chunk = page.slice(i, i + MATCH_CONCURRENCY);
      const rules = await Promise.all(chunk.map((row) => matchRow(userId, row, caches)));
      for (let j = 0; j < chunk.length; j++) {
        const row = chunk[j];
        const rule = rules[j];
        if (!rule) continue;
        const diff = diffOf(row, rule);
        if (diff.categories_category_id === undefined && diff.entities_entity_id === undefined) continue;
        if (changes.length >= MAX_CHANGES) return { changes, truncated: true };
        changes.push({
          transaction_id: String(row.transaction_id),
          date: Number(row.date_timestamp),
          description: row.description ?? '',
          amount: ConvertUtils.convertBigIntegerToFloat(row.amount),
          rule_id: String(rule.rule_id),
          current_category_id: idOrNull(row.categories_category_id),
          new_category_id: idOrNull(diff.categories_category_id ?? row.categories_category_id),
          current_entity_id: idOrNull(row.entities_entity_id),
          new_entity_id: idOrNull(diff.entities_entity_id ?? row.entities_entity_id),
        });
      }
    }
    if (page.length < PAGE_SIZE) break;
  }
  return { changes, truncated: false };
}

/**
 * Applies the current ruleset to the given transactions. Each one is re-matched here, so client-side
 * values are never trusted; ids that are not the user's, not eligible or no longer match count as skipped.
 */
export async function applyRuleChanges(
  userId: bigint,
  transactionIds: bigint[]
): Promise<{ updated: number; skipped: number }> {
  const ids = [...new Set(transactionIds)];
  const caches = await loadCaches(userId);
  const rows: Row[] = await prisma.transactions.findMany({
    where: { transaction_id: { in: ids }, ...eligibleWhere(userId) },
    select: rowSelect,
  });

  const updates: Array<{ id: bigint; data: ReturnType<typeof diffOf> }> = [];
  for (let i = 0; i < rows.length; i += MATCH_CONCURRENCY) {
    const chunk = rows.slice(i, i + MATCH_CONCURRENCY);
    const rules = await Promise.all(chunk.map((row) => matchRow(userId, row, caches)));
    chunk.forEach((row, j) => {
      const diff = rules[j] ? diffOf(row, rules[j]) : {};
      if (Object.keys(diff).length > 0) updates.push({ id: row.transaction_id, data: diff });
    });
  }

  // No balance recalculation: accounts, type and amount are untouched
  await performDatabaseRequest(async (tx) => {
    for (const { id, data } of updates) await tx.transactions.update({ where: { transaction_id: id }, data });
  });
  return { updated: updates.length, skipped: ids.length - updates.length };
}

export default { previewRuleApplication, applyRuleChanges };
