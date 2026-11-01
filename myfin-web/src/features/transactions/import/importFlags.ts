import {
  canLinkEvent,
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
  const event = canLinkEvent(trxType) ? choice.event : null;
  return allowed ? { ...choice, event } : { ...choice, kind: 'none', event };
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

export type SkippedFlag = {
  description: string;
  flag: 'loan' | 'event';
  message: string;
};

/** Names each failed flag by the row it belongs to, via the created id back to the submitted position. */
export function skippedFlagsFor(
  failed: Array<{
    transaction_id: string;
    flag: 'loan' | 'event';
    message: string;
  }>,
  rows: Array<{ description: string }>,
  createdByIndex: Array<{ index: number; transaction_id: string }>,
): SkippedFlag[] {
  const indexById = new Map(
    createdByIndex.map((created) => [
      String(created.transaction_id),
      created.index,
    ]),
  );
  return failed.map((item) => ({
    description:
      rows[indexById.get(String(item.transaction_id)) ?? -1]?.description ?? '',
    flag: item.flag,
    message: item.message,
  }));
}
