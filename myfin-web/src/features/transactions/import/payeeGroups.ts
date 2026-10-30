import { PayeeRule, TransactionType } from '../../../services/trx/trxServices.ts';
import { IdLabelPair } from '../AddEditTransactionDialog.tsx';

export type GroupableTrx = {
  tempId: number;
  selected: boolean;
  type?: TransactionType;
  payee?: string | null;
  payeeMatch?: string | null;
  value: number;
  category?: IdLabelPair;
  entity?: IdLabelPair;
  essential: boolean;
};

export type PayeeGroup = {
  key: string;
  payee: string;
  type: TransactionType.Expense | TransactionType.Income;
  matchText: string | null;
  rowIds: number[];
  count: number;
};

export type GroupFieldValue<T> =
  | { kind: 'none' }
  | { kind: 'single'; value: T }
  | { kind: 'mixed' };

export type GroupPatch = Partial<
  Pick<GroupableTrx, 'category' | 'entity' | 'essential'>
>;

/** Fields of a group the user changed on its line; only these become a remembered rule. */
export type TouchedFields = { category?: boolean; entity?: boolean; essential?: boolean };

const isGroupable = (
  row: GroupableTrx,
): row is GroupableTrx & {
  payee: string;
  type: TransactionType.Expense | TransactionType.Income;
} =>
  !!row.payee &&
  (row.type === TransactionType.Expense || row.type === TransactionType.Income);

/** Groups rows by direction and payee (case-insensitive), most transactions first. */
export const buildPayeeGroups = (rows: GroupableTrx[]): PayeeGroup[] => {
  const groups = new Map<string, PayeeGroup>();
  for (const row of rows) {
    if (!isGroupable(row)) continue;
    const key = `${row.type}:${row.payee.toLowerCase()}`;
    const group = groups.get(key);
    if (group) {
      group.rowIds.push(row.tempId);
      group.count++;
      group.matchText ??= row.payeeMatch ?? null;
    } else {
      groups.set(key, {
        key,
        payee: row.payee,
        type: row.type,
        matchText: row.payeeMatch ?? null,
        rowIds: [row.tempId],
        count: 1,
      });
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || a.payee.localeCompare(b.payee),
  );
};

const rowsOf = (rows: GroupableTrx[], group: PayeeGroup) => {
  const ids = new Set(group.rowIds);
  return rows.filter((row) => ids.has(row.tempId));
};

/** The value shared by every row of the group, "none" if all are blank, "mixed" if they differ. */
export const groupFieldValue = <T>(
  rows: GroupableTrx[],
  group: PayeeGroup,
  pick: (row: GroupableTrx) => T | undefined,
  same: (a: T, b: T) => boolean = (a, b) => a === b,
): GroupFieldValue<T> => {
  const values = rowsOf(rows, group).map(pick);
  const present = values.filter((v): v is T => v !== undefined);
  if (present.length === 0) return { kind: 'none' };
  if (present.length < values.length) return { kind: 'mixed' };
  return present.every((v) => same(v, present[0]))
    ? { kind: 'single', value: present[0] }
    : { kind: 'mixed' };
};

const sameOption = (a: IdLabelPair, b: IdLabelPair) =>
  String(a.id) === String(b.id);

export const groupCategory = (rows: GroupableTrx[], group: PayeeGroup) =>
  groupFieldValue(rows, group, (r) => r.category, sameOption);
export const groupEntity = (rows: GroupableTrx[], group: PayeeGroup) =>
  groupFieldValue(rows, group, (r) => r.entity, sameOption);
export const groupEssential = (rows: GroupableTrx[], group: PayeeGroup) =>
  groupFieldValue(rows, group, (r) => r.essential);

/**
 * Applies a group edit. Without `overwrite` a field is only set on rows where it is blank
 * (`essential` counts as blank when false), so values from rules or earlier edits survive.
 */
export const fillBlankRows = <T extends GroupableTrx>(
  rows: T[],
  group: PayeeGroup,
  patch: GroupPatch,
  overwrite: boolean,
): T[] => {
  const ids = new Set(group.rowIds);
  return rows.map((row) => {
    if (!ids.has(row.tempId)) return row;
    const next = { ...row };
    if ('category' in patch && (overwrite || !row.category))
      next.category = patch.category;
    if ('entity' in patch && (overwrite || !row.entity))
      next.entity = patch.entity;
    if ('essential' in patch && (overwrite || !row.essential))
      next.essential = patch.essential ?? false;
    return next;
  });
};

/**
 * One rule per group the user touched, using only the touched fields that have a single shared
 * value. Groups without match text (no payee prefix) or with no selected row create nothing.
 */
export const toPayeeRules = (
  rows: GroupableTrx[],
  groups: PayeeGroup[],
  touched: Record<string, TouchedFields>,
): PayeeRule[] => {
  const rules: PayeeRule[] = [];
  for (const group of groups) {
    const fields = touched[group.key];
    if (!fields || !group.matchText) continue;
    if (!rowsOf(rows, group).some((row) => row.selected)) continue;

    const rule: PayeeRule = { match_text: group.matchText, type: group.type };
    if (fields.category) {
      const v = groupCategory(rows, group);
      if (v.kind === 'single') rule.category_id = v.value.id;
    }
    if (fields.entity) {
      const v = groupEntity(rows, group);
      if (v.kind === 'single') rule.entity_id = v.value.id;
    }
    if (fields.essential) {
      const v = groupEssential(rows, group);
      if (v.kind === 'single') rule.is_essential = v.value;
    }
    if (
      rule.category_id !== undefined ||
      rule.entity_id !== undefined ||
      rule.is_essential !== undefined
    ) {
      rules.push(rule);
    }
  }
  return rules;
};
