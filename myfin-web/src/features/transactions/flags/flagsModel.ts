type TrxType = 'E' | 'I' | 'T';

export type FlagChoice = {
  kind: 'none' | 'loan' | 'investment';
  loanName?: string;
  investmentAccountId?: number;
  event?: { event_id: string } | { new_event: { name: string } } | null;
};

export const NO_FLAGS: FlagChoice = { kind: 'none', event: null };

export type ApiTransactionFlags = {
  loan?: { name?: string; due_date?: number | null };
  event?: { event_id: string } | { new_event: { name: string; kind?: string } };
};

export const canMarkLoan = (trxType: TrxType) =>
  trxType === 'E' || trxType === 'I';

/** Income is not event spending. */
export const canLinkEvent = (trxType: TrxType) => trxType !== 'I';

export const canMarkInvestment = (trxType: TrxType) => trxType === 'E';

/** Investment is not a server flag (see applyInvestment), so it never appears here. */
export function toApiFlags(choice: FlagChoice): ApiTransactionFlags {
  const flags: ApiTransactionFlags = {};
  if (choice.kind === 'loan') {
    const name = choice.loanName?.trim();
    flags.loan = name ? { name } : {};
  }
  if (choice.event) flags.event = choice.event;
  return flags;
}

/** An investment is saved as a transfer into the chosen investing account. */
export function applyInvestment(
  trx: { type: TrxType; account_to_id?: number },
  choice: FlagChoice,
): { type: TrxType; account_to_id?: number } {
  if (choice.kind !== 'investment' || choice.investmentAccountId == null)
    return trx;
  return { type: 'T', account_to_id: choice.investmentAccountId };
}

/**
 * A transfer into an investing account is not spending: it must not carry a category or the
 * essential flag, which budgets would otherwise count. Apply after applyInvestment.
 */
export function clearInvestmentFields<
  T extends { category_id?: unknown; is_essential?: boolean },
>(trx: T, choice: FlagChoice): T {
  if (choice.kind !== 'investment' || choice.investmentAccountId == null)
    return trx;
  return { ...trx, category_id: undefined, is_essential: false };
}

export type GroupFlagRow = {
  tempId: number;
  type: TrxType;
  fromAccountId?: bigint | number | null;
};

/**
 * The choice every row of a group should carry after "mark all". Marks a row does not allow are
 * left out: loan/investment on a transfer, investment on income, an event on income, and an
 * investment into the row's own from-account. `marked` counts rows that carry any mark.
 */
export function groupFlagChoices(
  rows: GroupFlagRow[],
  choice: FlagChoice,
): { choices: Map<number, FlagChoice>; marked: number } {
  const choices = new Map<number, FlagChoice>();
  let marked = 0;
  for (const row of rows) {
    const kindAllowed =
      (choice.kind === 'loan' && canMarkLoan(row.type)) ||
      (choice.kind === 'investment' &&
        canMarkInvestment(row.type) &&
        choice.investmentAccountId != null &&
        (row.fromAccountId == null ||
          Number(row.fromAccountId) !== choice.investmentAccountId));
    const event = canLinkEvent(row.type) ? (choice.event ?? null) : null;
    const next: FlagChoice = kindAllowed
      ? { ...choice, event }
      : { kind: 'none', event };
    choices.set(row.tempId, next);
    if (next.kind !== 'none' || next.event) marked += 1;
  }
  return { choices, marked };
}
