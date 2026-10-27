import { axios } from '../../data/axios.ts';
import { Account } from '../auth/authServices.ts';
import { Category } from '../category/categoryServices.ts';
import { CachedTransaction } from '../../data/localStore.ts';

export type TransactionsPageResponse = {
  filtered_count: number;
  total_count: number;
  results: Array<Transaction>;
};

export type Transaction = {
  transaction_id: bigint;
  account_from_name?: string;
  account_to_name?: string;
  accounts_account_from_id?: bigint;
  accounts_account_to_id?: bigint;
  amount: number;
  categories_category_id?: bigint;
  category_name?: string;
  category_icon_key?: string;
  date_timestamp?: number;
  description?: string;
  entity_id?: bigint;
  entity_name?: string;
  is_essential: 0 | 1;
  tag_names?: Array<string>;
  tags?: Array<Tag>;
  /** 'YYYY-MM' the row counts in for analytics (late salary counts in the next month). */
  effective_month?: string;
};

export enum TransactionType {
  Income = 'I',
  Expense = 'E',
  Transfer = 'T',
}

export type Tag = {
  tag_id: bigint;
  users_user_id: bigint;
  name: string;
  description?: string;
};

export type TransactionSortField = 'date' | 'amount' | 'type';

export type TransactionListOptions = {
  sortBy?: TransactionSortField;
  sortDir?: 'asc' | 'desc';
  type?: TransactionType;
  /** epoch seconds, inclusive */
  dateFrom?: number;
  /** epoch seconds, exclusive */
  dateTo?: number;
  /** category id or 'none' (uncategorised) */
  categoryId?: string;
  payeeKey?: string;
  /** matches either side of a transaction */
  accountId?: string;
  /** 'YYYY-MM' effective month (see Insights drill-down) */
  effectiveMonth?: string;
  costKind?: 'fixed' | 'flexible' | 'unsorted';
};

const getTransactions = (
  page: number,
  page_size?: number,
  query?: string,
  options: TransactionListOptions = {},
) => {
  return axios.get<TransactionsPageResponse>(`/trxs/filteredByPage/${page}`, {
    params: {
      page_size,
      query,
      sort_by: options.sortBy,
      sort_dir: options.sortDir,
      type: options.type,
      date_from: options.dateFrom,
      date_to: options.dateTo,
      category_id: options.categoryId,
      payee_key: options.payeeKey,
      account_id: options.accountId,
      effective_month: options.effectiveMonth,
      cost_kind: options.costKind,
    },
  });
};

export type Entity = {
  entity_id: bigint;
  name: string;
  users_user_id: number;
};

export type TransactionStep0Response = {
  accounts: Account[];
  categories: Category[];
  entities: Entity[];
  tags: Tag[];
  cachedTrx?: CachedTransaction;
};

const addTransactionStep0 = () => {
  return axios.post<TransactionStep0Response>('/trxs/step0');
};

export type AddTransactionRequest = {
  amount: number;
  type: TransactionType;
  description?: string;
  entity_id?: bigint;
  account_from_id?: bigint;
  account_to_id?: bigint;
  category_id?: bigint;
  date_timestamp?: number;
  is_essential: boolean;
  tags?: string;
  external_id?: string;
};

const addTransactionStep1 = (data: AddTransactionRequest): Promise<string> => {
  return axios.post('/trxs/step1', data);
};

export type EditTransactionRequest = {
  new_amount: number;
  new_type: TransactionType;
  new_description?: string;
  new_entity_id?: bigint;
  new_account_from_id?: bigint;
  new_account_to_id?: bigint;
  new_category_id?: bigint;
  new_date_timestamp?: number;
  new_is_essential: boolean;
  transaction_id: bigint;
  tags?: string;
  /* Split trx */
  is_split?: boolean;
  split_amount?: number;
  split_category?: bigint;
  split_entity?: bigint;
  split_type?: TransactionType;
  split_account_from?: bigint;
  split_account_to?: bigint;
  split_description?: string;
  split_is_essential?: boolean;
  split_tags?: string;
};

const editTransaction = (data: EditTransactionRequest): Promise<string> => {
  return axios.put('/trxs', data);
};

const removeTransaction = (trxId: bigint) => {
  return axios.delete<string>(`/trxs`, { data: { transaction_id: trxId } });
};

export type AutoCategorizeTransactionRequest = {
  description: string;
  amount: number;
  type: TransactionType;
  account_from_id: bigint;
  account_to_id: bigint;
};

export type RuleInstructions = {
  matching_rule?: bigint;
  date?: number;
  description?: string;
  amount?: number;
  type?: TransactionType;
  selectedCategoryID?: bigint;
  selectedEntityID?: bigint;
  selectedAccountFromID?: bigint;
  selectedAccountToID?: bigint;
  isEssential?: boolean;
};

const autoCategorizeTrx = (request: AutoCategorizeTransactionRequest) => {
  return axios.post<RuleInstructions>(`/trxs/auto-cat-trx`, request);
};

export type TransactionsInMonthForCategoryRequest = {
  month: number;
  year: number;
  cat_id: bigint;
  type: TransactionType;
};

const getTransactionsForCategoryInMonth = (
  request: TransactionsInMonthForCategoryRequest,
) => {
  return axios.get<Transaction[]>(`/trxs/inMonthAndCategory`, {
    params: request,
  });
};

const importTransactionsStep0 = () => {
  return axios.post<Account[]>('/trxs/import/step0');
};

export type ImportTransactionsStep1Request = {
  account_id: bigint;
  trx_list: ExportedTransactionItem[];
};
export type ExportedTransactionItem = {
  date: number;
  description: string;
  amount: number;
  type: TransactionType;
};
export type ImportTransactionsStep1Response = {
  accounts: Account[];
  categories: Category[];
  entities: Entity[];
  fillData: (RuleInstructions & { external_id?: string })[];
};

const importTransactionsStep1 = (request: ImportTransactionsStep1Request) => {
  return axios.post<ImportTransactionsStep1Response>('/trxs/import/step1', {
    account_id: request.account_id,
    trx_list: JSON.stringify(request.trx_list),
  });
};

export type ImportTransactionsStep2Response = {
  imported: number;
  skipped: number;
};

const importTransactionsStep2 = (list: AddTransactionRequest[]) => {
  return axios.post<ImportTransactionsStep2Response>('/trxs/import/step2', {
    trx_list: JSON.stringify(list),
  });
};

export type PhonePeInstrument = {
  key: string;
  sample_description: string;
  account_id: bigint | null;
};

export type PhonePePreviewResponse = {
  instruments: PhonePeInstrument[];
  total_rows: number;
  duplicate_rows: number;
  new_rows: number;
};

export type PhonePeCategorizeRequest = {
  csv: string;
  mappings: { key: string; account_id: bigint }[];
};

export type PhonePeCategorizeResponse = ImportTransactionsStep1Response & {
  fillData: (RuleInstructions & { external_id: string })[];
  duplicate_rows: number;
};

const importPhonePePreview = (csv: string) => {
  return axios.post<PhonePePreviewResponse>('/trxs/import/phonepe/preview', {
    csv,
  });
};

const importPhonePeCategorize = (request: PhonePeCategorizeRequest) => {
  return axios.post<PhonePeCategorizeResponse>(
    '/trxs/import/phonepe/categorize',
    {
      csv: request.csv,
      mappings: JSON.stringify(request.mappings),
    },
  );
};

export type BulkUpdateTransactionsRequest = {
  transaction_ids?: bigint[];
  filter?: {
    query: string;
    type?: TransactionType;
    date_from?: number;
    date_to?: number;
    category_id?: string;
    payee_key?: string;
    account_id?: string;
    effective_month?: string;
    cost_kind?: 'fixed' | 'flexible' | 'unsorted';
  };
  category_id?: bigint | null;
  entity_id?: bigint | null;
  is_essential?: boolean;
};

const bulkUpdateTransactions = (request: BulkUpdateTransactionsRequest) => {
  return axios.put<{ updated: number }>('/trxs/bulk', request);
};

export default {
  bulkUpdateTransactions,
  getTransactions,
  removeTransaction,
  addTransactionStep0,
  addTransactionStep1,
  editTransaction,
  autoCategorizeTrx,
  getTransactionsForCategoryInMonth,
  importTransactionsStep0,
  importTransactionsStep1,
  importTransactionsStep2,
  importPhonePePreview,
  importPhonePeCategorize,
};
