import {
  canMarkInvestment,
  canMarkLoan,
  type FlagChoice,
  toApiFlags,
} from '../flags/flagsModel.ts';

/** A row's type can change after it was flagged (e.g. an account is added), so drop marks it no longer allows. */
export function effectiveChoice(
  choice: FlagChoice,
  trxType: 'E' | 'I' | 'T',
): FlagChoice {
  const allowed =
    (choice.kind === 'loan' && canMarkLoan(trxType)) ||
    (choice.kind === 'investment' && canMarkInvestment(trxType));
  return allowed ? choice : { ...choice, kind: 'none' };
}

/**
 * Pairs each created row with its new transaction id. `index` is the row's position in the
 * submitted list; rows the server skipped as duplicates are absent from `createdByIndex`.
 * Investment is not a server flag (those rows were already sent as transfers).
 */
export function flagItemsForCreated(
  rows: Array<{ choice: FlagChoice }>,
  createdByIndex: Array<{ index: number; transaction_id: string }>,
): Array<{ transaction_id: string; flags: ReturnType<typeof toApiFlags> }> {
  const items: Array<{
    transaction_id: string;
    flags: ReturnType<typeof toApiFlags>;
  }> = [];
  for (const { index, transaction_id } of createdByIndex) {
    const row = rows[index];
    if (!row) continue;
    const flags = toApiFlags(row.choice);
    if (!flags.loan && !flags.event) continue;
    items.push({ transaction_id: String(transaction_id), flags });
  }
  return items;
}
