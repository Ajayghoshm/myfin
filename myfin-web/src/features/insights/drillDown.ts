export type TransactionsLinkParams = {
  month: string; // 'YYYY-MM'
  type?: 'E' | 'I' | 'T';
  category?: string; // category id | 'none'
  payee?: string; // payee key, exactly as received from the API
  account?: string; // account id
  cost?: 'fixed' | 'flexible'; // fixed / flexible expense split
};

/** API limit for payee keys in filters and classifications (joi max 255). */
export const MAX_PAYEE_KEY_LENGTH = 255;

/** Whether a payee key can be filtered on or classified: non-empty and within the API limit. */
export function isActionablePayeeKey(payeeKey: string): boolean {
  return payeeKey !== '' && payeeKey.length <= MAX_PAYEE_KEY_LENGTH;
}

/** Link to the Transactions page with drill-down filters in the URL. */
export function buildTransactionsLink(params: TransactionsLinkParams): string {
  const search = new URLSearchParams();
  search.set('month', params.month);
  if (params.type) search.set('type', params.type);
  if (params.category) search.set('category', params.category);
  if (params.payee) search.set('payee', params.payee);
  if (params.account) search.set('account', params.account);
  if (params.cost) search.set('cost', params.cost);
  return `/transactions?${search.toString()}`;
}
