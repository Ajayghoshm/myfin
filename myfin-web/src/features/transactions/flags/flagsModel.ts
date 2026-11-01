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
