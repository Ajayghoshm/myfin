// Type-only imports keep this module free of app runtime code, so it can be unit-tested with plain Node
import type {
  PayeeRule,
  TransactionType,
} from '../../../services/trx/trxServices.ts';
import type { IdLabelPair } from '../AddEditTransactionDialog.tsx';

// Same values as TransactionType.Expense / .Income
const EXPENSE = 'E' as TransactionType.Expense;
const INCOME = 'I' as TransactionType.Income;

export type GroupableTrx = {
  tempId: number;
  selected: boolean;
  type?: TransactionType;
  payee?: string | null;
  payeeMatch?: string | null;
  payeeMatchExact?: boolean;
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
  matchExact: boolean;
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

const isGroupable = (
  row: GroupableTrx,
): row is GroupableTrx & {
  payee: string;
  type: TransactionType.Expense | TransactionType.Income;
} =>
  !!row.payee &&
  (row.type === EXPENSE || row.type === INCOME);

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
      if (group.matchText == null && row.payeeMatch != null) {
        group.matchText = row.payeeMatch;
        group.matchExact = row.payeeMatchExact ?? false;
      }
    } else {
      groups.set(key, {
        key,
        payee: row.payee,
        type: row.type,
        matchText: row.payeeMatch ?? null,
        matchExact: row.payeeMatchExact ?? false,
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
 * One rule per group the user made a choice on (`chosen`: the last value picked per field).
 * The rule stores what the user picked, not what the rows happen to carry, so a guessed value the
 * user replaced is never remembered. Fields the user did not pick are sent as `defaults` (the
 * value all selected rows share) and are used only when the rule is new, so a new rule does not
 * lose fields that used to be auto-filled. Groups without match text or without a selected row
 * create nothing.
 */
export const toPayeeRules = (
  rows: GroupableTrx[],
  groups: PayeeGroup[],
  chosen: Record<string, GroupPatch>,
): PayeeRule[] => {
  const rules: PayeeRule[] = [];
  for (const group of groups) {
    const patch = chosen[group.key];
    if (!patch || !group.matchText) continue;
    const selected = rowsOf(rows, group).filter((row) => row.selected);
    if (selected.length === 0) continue;
    const selectedGroupRows = { ...group, rowIds: selected.map((r) => r.tempId) };

    const rule: PayeeRule = { match_text: group.matchText, type: group.type };
    if (group.matchExact) rule.exact = true;
    const defaults: NonNullable<PayeeRule['defaults']> = {};

    if (patch.category) rule.category_id = patch.category.id;
    else if (!('category' in patch)) {
      const v = groupCategory(selected, selectedGroupRows);
      if (v.kind === 'single') defaults.category_id = v.value.id;
    }
    if (patch.entity) rule.entity_id = patch.entity.id;
    else if (!('entity' in patch)) {
      const v = groupEntity(selected, selectedGroupRows);
      if (v.kind === 'single') defaults.entity_id = v.value.id;
    }
    if (patch.essential !== undefined) rule.is_essential = patch.essential;
    else {
      const v = groupEssential(selected, selectedGroupRows);
      if (v.kind === 'single' && v.value) defaults.is_essential = true;
    }

    const hasChoice =
      rule.category_id !== undefined ||
      rule.entity_id !== undefined ||
      rule.is_essential !== undefined;
    if (!hasChoice) continue;
    if (Object.keys(defaults).length > 0) rule.defaults = defaults;
    rules.push(rule);
  }
  return rules;
};
