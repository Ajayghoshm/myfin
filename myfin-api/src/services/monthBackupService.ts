import { performDatabaseRequest } from '../config/prisma.js';
import { MYFIN, normalizeCategoryIconKey } from '../consts.js';
import APIError from '../errorHandling/apiError.js';
import AccountService from './accountService.js';
import { monthRangeIST } from './insights/insightsPrimitives.js';

const FORMAT = 'myfin-month-backup';
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MAX_TRANSACTIONS = 50_000;

type NamedAccount = { name: string; type: string } | null;
type NamedCategory = { name: string; type: string; color_gradient: string | null; icon_key: string } | null;

export type MonthBackupTransaction = {
  date_timestamp: number;
  amount: number;
  type: string;
  description: string | null;
  is_essential: boolean;
  is_adjustment: boolean;
  external_id: string | null;
  account_from: NamedAccount;
  account_to: NamedAccount;
  category: NamedCategory;
  entity: string | null;
  tags: string[];
};

export type MonthBackup = {
  format: typeof FORMAT;
  month: string;
  exported_at: number;
  transactions: MonthBackupTransaction[];
};

export const parseMonth = (month: unknown) => {
  const m = typeof month === 'string' ? MONTH_RE.exec(month) : null;
  if (!m) throw APIError.badRequest('Month must look like YYYY-MM');
  return monthRangeIST({ year: Number(m[1]), month: Number(m[2]) });
};

const key = (s: string) => s.trim().toLowerCase();

/**
 * Month-level backups are portable: every account, category, entity and tag is stored by name,
 * so a month can be merged into any dataset (including after a full restore changed all ids).
 */
const MonthBackupService = {
  exportMonth: async (userId: bigint, month: string): Promise<MonthBackup> => {
    const { from, to } = parseMonth(month);
    return performDatabaseRequest(async (db) => {
      const rows = await db.transactions.findMany({
        where: {
          date_timestamp: { gte: from, lt: to },
          OR: [
            { accounts_transactions_accounts_account_from_idToaccounts: { users_user_id: userId } },
            { accounts_transactions_accounts_account_to_idToaccounts: { users_user_id: userId } },
          ],
        },
        orderBy: [{ date_timestamp: 'asc' }, { transaction_id: 'asc' }],
        include: {
          accounts_transactions_accounts_account_from_idToaccounts: true,
          accounts_transactions_accounts_account_to_idToaccounts: true,
          categories: true,
          entities: true,
          transaction_has_tags: { include: { tags: true } },
        },
      });
      const acc = (a: { name: string; type: string } | null): NamedAccount =>
        a ? { name: a.name, type: a.type } : null;
      return {
        format: FORMAT,
        month,
        exported_at: Math.floor(Date.now() / 1000),
        transactions: rows.map((t) => ({
          date_timestamp: Number(t.date_timestamp),
          amount: Number(t.amount),
          type: t.type,
          description: t.description,
          is_essential: t.is_essential,
          is_adjustment: t.is_adjustment,
          external_id: t.external_id,
          account_from: acc(t.accounts_transactions_accounts_account_from_idToaccounts),
          account_to: acc(t.accounts_transactions_accounts_account_to_idToaccounts),
          category: t.categories
            ? {
                name: t.categories.name,
                type: t.categories.type,
                color_gradient: t.categories.color_gradient,
                icon_key: t.categories.icon_key,
              }
            : null,
          entity: t.entities?.name ?? null,
          tags: t.transaction_has_tags.map((l) => l.tags.name),
        })),
      };
    }, undefined);
  },

  /** Throws a 400 describing the first problem; the month, when given, must match the file. */
  validate: (data: unknown): MonthBackup => {
    const d = data as Partial<MonthBackup> | null;
    if (!d || d.format !== FORMAT || !Array.isArray(d.transactions)) {
      throw APIError.badRequest('This is not a month backup file');
    }
    parseMonth(d.month);
    if (d.transactions.length > MAX_TRANSACTIONS) throw APIError.badRequest('Backup is too large');
    const types: string[] = Object.values(MYFIN.TRX_TYPES);
    const accountTypes: string[] = Object.values(MYFIN.ACCOUNT_TYPES);
    d.transactions.forEach((t, i) => {
      const bad = (what: string) => APIError.badRequest(`Transaction #${i + 1}: ${what}`);
      if (!types.includes(t?.type)) throw bad('unknown type');
      if (!Number.isFinite(t.date_timestamp) || !Number.isInteger(t.amount) || t.amount < 0) {
        throw bad('invalid date or amount');
      }
      for (const a of [t.account_from, t.account_to]) {
        if (a && (typeof a.name !== 'string' || !accountTypes.includes(a.type))) {
          throw bad('invalid account');
        }
      }
      if (!t.account_from && !t.account_to) throw bad('has no account');
      if (t.category && (typeof t.category.name !== 'string' || t.category.name.trim() === '')) {
        throw bad('invalid category');
      }
      if (!Array.isArray(t.tags)) throw bad('invalid tags');
    });
    return d as MonthBackup;
  },

  /**
   * Adds the file's transactions to the user's data. Nothing existing is changed or deleted;
   * a transaction already present (same external id, or same date/amount/type/description/accounts)
   * is skipped. Missing accounts, categories, entities and tags are created by name.
   */
  importMonth: async (userId: bigint, raw: unknown) => {
    const data = MonthBackupService.validate(raw);
    return performDatabaseRequest(
      async (db) => {
        const [accounts, categories, entities, tags] = await Promise.all([
          db.accounts.findMany({ where: { users_user_id: userId } }),
          db.categories.findMany({ where: { users_user_id: userId } }),
          db.entities.findMany({ where: { users_user_id: userId } }),
          db.tags.findMany({ where: { users_user_id: userId } }),
        ]);
        const accountIds = new Map(accounts.map((a) => [key(a.name), a.account_id]));
        const categoryIds = new Map(categories.map((c) => [key(c.name), c.category_id]));
        const entityIds = new Map(entities.map((e) => [key(e.name), e.entity_id]));
        const tagIds = new Map(tags.map((t) => [key(t.name), t.tag_id]));
        const created = { accounts: 0, categories: 0, entities: 0, tags: 0 };

        const accountId = async (a: NamedAccount) => {
          if (!a) return null;
          let id = accountIds.get(key(a.name));
          if (id === undefined) {
            id = (
              await db.accounts.create({
                data: {
                  name: a.name,
                  type: a.type,
                  description: '',
                  exclude_from_budgets: false,
                  status: MYFIN.ACCOUNT_STATUS.ACTIVE,
                  users_user_id: userId,
                  current_balance: 0,
                  created_timestamp: Math.floor(Date.now() / 1000),
                  color_gradient: 'blue-gradient',
                },
              })
            ).account_id;
            accountIds.set(key(a.name), id);
            created.accounts++;
          }
          return id;
        };
        const categoryId = async (c: NamedCategory) => {
          if (!c) return null;
          let id = categoryIds.get(key(c.name));
          if (id === undefined) {
            id = (
              await db.categories.create({
                data: {
                  name: c.name,
                  type: c.type === 'I' ? 'I' : 'M',
                  users_user_id: userId,
                  description: '',
                  color_gradient: c.color_gradient,
                  icon_key: normalizeCategoryIconKey(c.icon_key),
                  status: MYFIN.CATEGORY_STATUS.ACTIVE,
                  exclude_from_budgets: 0,
                },
              })
            ).category_id;
            categoryIds.set(key(c.name), id);
            created.categories++;
          }
          return id;
        };
        const entityId = async (name: string | null) => {
          if (!name) return null;
          let id = entityIds.get(key(name));
          if (id === undefined) {
            id = (await db.entities.create({ data: { name, users_user_id: userId } })).entity_id;
            entityIds.set(key(name), id);
            created.entities++;
          }
          return id;
        };
        const tagId = async (name: string) => {
          let id = tagIds.get(key(name));
          if (id === undefined) {
            id = (await db.tags.create({ data: { name, description: '', users_user_id: userId } }))
              .tag_id;
            tagIds.set(key(name), id);
            created.tags++;
          }
          return id;
        };

        const { from, to } = parseMonth(data.month);
        const existing = await db.transactions.findMany({
          where: {
            date_timestamp: { gte: from, lt: to },
            OR: [
              { accounts_transactions_accounts_account_from_idToaccounts: { users_user_id: userId } },
              { accounts_transactions_accounts_account_to_idToaccounts: { users_user_id: userId } },
            ],
          },
        });
        const externalIds = new Set(existing.map((t) => t.external_id).filter(Boolean));
        const fingerprint = (
          date: number,
          amount: number,
          type: string,
          description: string | null,
          from_: bigint | null,
          to_: bigint | null
        ) => [date, amount, type, description ?? '', from_ ?? '', to_ ?? ''].join('|');
        const seen = new Set(
          existing.map((t) =>
            fingerprint(
              Number(t.date_timestamp),
              Number(t.amount),
              t.type,
              t.description,
              t.accounts_account_from_id,
              t.accounts_account_to_id
            )
          )
        );

        let imported = 0;
        let skipped = 0;
        for (const t of data.transactions) {
          const fromId = await accountId(t.account_from);
          const toId = await accountId(t.account_to);
          const fp = fingerprint(t.date_timestamp, t.amount, t.type, t.description, fromId, toId);
          if ((t.external_id && externalIds.has(t.external_id)) || seen.has(fp)) {
            skipped++;
            continue;
          }
          const trx = await db.transactions.create({
            data: {
              date_timestamp: t.date_timestamp,
              amount: t.amount,
              type: t.type,
              description: t.description,
              is_essential: !!t.is_essential,
              is_adjustment: !!t.is_adjustment,
              external_id: t.external_id ?? undefined,
              accounts_account_from_id: fromId,
              accounts_account_to_id: toId,
              categories_category_id: await categoryId(t.category),
              entities_entity_id: await entityId(t.entity),
            },
          });
          const tagRows = [];
          for (const name of new Set(t.tags)) {
            tagRows.push({
              transactions_transaction_id: trx.transaction_id,
              tags_tag_id: await tagId(name),
            });
          }
          if (tagRows.length) await db.transaction_has_tags.createMany({ data: tagRows });
          seen.add(fp);
          if (t.external_id) externalIds.add(t.external_id);
          imported++;
        }

        if (imported > 0) await AccountService.recalculateAllUserAccountsBalances(userId, db);
        return { month: data.month, imported, skipped, created };
      },
      undefined,
      { timeout: 120_000 }
    );
  },
};

export default MonthBackupService;
