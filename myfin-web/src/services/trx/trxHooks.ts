import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../../data/react-query.ts';
import { QUERY_KEY_GET_BUDGET_MATRIX } from '../budget/budgetHooks.ts';
import TrxServices, {
  AddTransactionRequest,
  AutoCategorizeTransactionRequest,
  BulkUpdateTransactionsRequest,
  EditTransactionRequest,
  ImportTransactionsStep1Request,
  PhonePeCategorizeRequest,
  TransactionListOptions,
  TransactionsInMonthForCategoryRequest,
} from './trxServices.ts';
import { announceCreatedTransactions } from '../planned/plannedMatchBus.ts';
import {
  QUERY_KEY_GET_EMERGENCY_FUND,
  QUERY_KEY_GET_SAFE_TO_SPEND,
} from '../insights/insightsHooks.ts';
import { QUERY_KEY_GET_SALARY_PLAN } from '../salaryPlan/salaryPlanHooks.ts';
import {
  QUERY_KEY_GET_DEBTS,
  QUERY_KEY_GET_LOAN_MATCH_SUGGESTIONS,
  QUERY_KEY_GET_LOANS,
  QUERY_KEY_GET_REPAYMENT_SUGGESTIONS,
} from '../debts/debtQueryKeys.ts';
import { useUserData } from '../../providers/UserProvider.tsx';
import { invalidateEventQueries } from '../events/eventHooks.ts';

export const QUERY_KEY_GET_TRANSACTIONS = 'QUERY_KEY_GET_TRANSACTIONS';
const QUERY_KEY_ADD_TRANSACTION_STEP0 = 'QUERY_KEY_ADD_TRANSACTION_STEP0';
export const QUERY_KEY_IMPORT_TRANSACTIONS_STEP0 =
  'QUERY_KEY_IMPORT_TRANSACTIONS_STEP0';
const QUERY_KEY_IMPORT_TRANSACTIONS_STEP1 =
  'QUERY_KEY_IMPORT_TRANSACTIONS_STEP1';
const QUERY_KEY_IMPORT_TRANSACTIONS_STEP2 =
  'QUERY_KEY_IMPORT_TRANSACTIONS_STEP2';
const MUTATION_KEY_IMPORT_PHONEPE_PREVIEW =
  'MUTATION_KEY_IMPORT_PHONEPE_PREVIEW';
const MUTATION_KEY_IMPORT_PHONEPE_CATEGORIZE =
  'MUTATION_KEY_IMPORT_PHONEPE_CATEGORIZE';
const MUTATION_KEY_AUTO_CATEGORIZE_TRANSACTION = [
  'MUTATION_KEY_AUTO_CATEGORIZE_TRANSACTION',
];
const QUERY_KEY_GET_TRX_FOR_CATEGORY_IN_MONTH =
  'QUERY_KEY_GET_TRX_FOR_CATEGORY_IN_MONTH';

/** Planning figures (and debts, whose linked rows can change) that depend on real transactions. */
function invalidatePlanningFigures() {
  for (const key of [
    QUERY_KEY_GET_SAFE_TO_SPEND,
    QUERY_KEY_GET_SALARY_PLAN,
    QUERY_KEY_GET_EMERGENCY_FUND,
    QUERY_KEY_GET_DEBTS,
    QUERY_KEY_GET_REPAYMENT_SUGGESTIONS,
    QUERY_KEY_GET_LOANS,
    QUERY_KEY_GET_LOAN_MATCH_SUGGESTIONS,
  ])
    void queryClient.invalidateQueries({ queryKey: [key] });
  invalidateEventQueries();
}

export function useGetTransactions(
  page: number,
  pageSize: number,
  query?: string,
  options: TransactionListOptions = {},
) {
  async function getTransactions() {
    const data = await TrxServices.getTransactions(
      page,
      pageSize,
      query,
      options,
    );
    return data.data;
  }

  return useQuery({
    queryKey: [
      QUERY_KEY_GET_TRANSACTIONS,
      page,
      pageSize,
      query,
      options.sortBy,
      options.sortDir,
      options.type,
      options.dateFrom,
      options.dateTo,
      options.effectiveMonth,
      options.day,
      options.categoryId,
      options.payeeKey,
      options.accountId,
      options.costKind,
      options.yearlyCost,
      options.amountLt,
      options.adjustment,
    ],
    queryFn: getTransactions,
    placeholderData: keepPreviousData,
  });
}

export function useRemoveTransaction() {
  async function removeTransaction(trxId: bigint) {
    const request = await TrxServices.removeTransaction(trxId);

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_TRANSACTIONS],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_MATRIX],
    });
    invalidatePlanningFigures();
    return request;
  }

  return useMutation({
    mutationFn: removeTransaction,
  });
}

export function useAddTransactionStep0() {
  const userData = useUserData();

  function getLastCachedTrx() {
    return userData.lastCachedTrx;
  }

  async function addTransactionStep0() {
    const data = await TrxServices.addTransactionStep0();
    const lastCachedTrx = getLastCachedTrx();
    return { ...data.data, cachedTrx: lastCachedTrx };
  }

  return useQuery({
    queryKey: [QUERY_KEY_ADD_TRANSACTION_STEP0],
    queryFn: addTransactionStep0,
    enabled: false,
  });
}

export function useAddTransactionStep1() {
  const { updateLastCachedTrx } = useUserData();

  function updateLastCachedTransaction(trx: AddTransactionRequest) {
    updateLastCachedTrx({
      amount: trx.amount,
      account_from_id: trx.account_from_id,
      account_to_id: trx.account_to_id,
      is_essential: +trx.is_essential as 0 | 1,
      date_timestamp: trx.date_timestamp,
      category_id: trx.category_id,
      entity_id: trx.entity_id,
    });
  }

  async function addTransaction(trx: AddTransactionRequest) {
    updateLastCachedTransaction(trx);
    const request = await TrxServices.addTransactionStep1(trx);

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_TRANSACTIONS],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_MATRIX],
    });
    invalidatePlanningFigures();
    if (request.data?.transaction_id != null) {
      announceCreatedTransactions([request.data.transaction_id]);
    }
    return request;
  }

  return useMutation({
    mutationFn: addTransaction,
  });
}

export function useEditTransaction() {
  async function editTransaction(trx: EditTransactionRequest) {
    const request = await TrxServices.editTransaction(trx);

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_TRANSACTIONS],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_MATRIX],
    });
    invalidatePlanningFigures();
    return request;
  }

  return useMutation({
    mutationFn: editTransaction,
  });
}

export function useAutoCategorizeTransaction() {
  async function autoCategorizeTransaction(
    trx: AutoCategorizeTransactionRequest,
  ) {
    const request = await TrxServices.autoCategorizeTrx(trx);
    return request.data;
  }

  return useMutation({
    mutationFn: autoCategorizeTransaction,
    mutationKey: MUTATION_KEY_AUTO_CATEGORIZE_TRANSACTION,
  });
}

export function useGetTransactionsForCategoryInMonth(
  request: TransactionsInMonthForCategoryRequest,
) {
  async function getTransactionsForCategory() {
    const data = await TrxServices.getTransactionsForCategoryInMonth(request);
    return data.data;
  }

  return useQuery({
    queryKey: [QUERY_KEY_GET_TRX_FOR_CATEGORY_IN_MONTH],
    queryFn: getTransactionsForCategory,
  });
}

export function useImportTransactionsStep0() {
  async function importTransactionsStep0() {
    const data = await TrxServices.importTransactionsStep0();
    return data.data;
  }

  return useQuery({
    queryKey: [QUERY_KEY_IMPORT_TRANSACTIONS_STEP0],
    queryFn: importTransactionsStep0,
    // accounts may be added in another tab while the import wizard is open
    refetchOnWindowFocus: true,
  });
}

export function useImportTransactionsStep1() {
  async function importTransactionsStep1(
    request: ImportTransactionsStep1Request,
  ) {
    const data = await TrxServices.importTransactionsStep1(request);
    return data.data;
  }

  return useMutation({
    mutationKey: [QUERY_KEY_IMPORT_TRANSACTIONS_STEP1],
    mutationFn: importTransactionsStep1,
  });
}

export function useImportTransactionsStep2() {
  async function importTransactionsStep2(list: AddTransactionRequest[]) {
    const data = await TrxServices.importTransactionsStep2(list);
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_TRANSACTIONS],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_MATRIX],
    });
    invalidatePlanningFigures();
    announceCreatedTransactions(data.data.created_ids ?? []);
    return data.data;
  }

  return useMutation({
    mutationKey: [QUERY_KEY_IMPORT_TRANSACTIONS_STEP2],
    mutationFn: importTransactionsStep2,
  });
}

export function useImportPhonePePreview() {
  async function importPhonePePreview(csv: string) {
    const data = await TrxServices.importPhonePePreview(csv);
    return data.data;
  }

  return useMutation({
    mutationKey: [MUTATION_KEY_IMPORT_PHONEPE_PREVIEW],
    mutationFn: importPhonePePreview,
  });
}

export function useImportPhonePeCategorize() {
  async function importPhonePeCategorize(request: PhonePeCategorizeRequest) {
    const data = await TrxServices.importPhonePeCategorize(request);
    return data.data;
  }

  return useMutation({
    mutationKey: [MUTATION_KEY_IMPORT_PHONEPE_CATEGORIZE],
    mutationFn: importPhonePeCategorize,
  });
}

export function useBulkUpdateTransactions() {
  async function bulkUpdateTransactions(
    request: BulkUpdateTransactionsRequest,
  ) {
    const data = await TrxServices.bulkUpdateTransactions(request);
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_TRANSACTIONS],
    });
    invalidatePlanningFigures();
    return data.data;
  }

  return useMutation({
    mutationFn: bulkUpdateTransactions,
  });
}
