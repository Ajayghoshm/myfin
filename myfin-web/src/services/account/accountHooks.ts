import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import AccountServices, {
  AddAccountRequest,
  EditAccountRequest,
} from './accountServices.ts';
import { queryClient } from '../../data/react-query.ts';
import { QUERY_KEY_GET_BUDGET_MATRIX } from '../budget/budgetHooks.ts';
import { useUserData } from '../../providers/UserProvider.tsx';
import { QUERY_KEY_IMPORT_TRANSACTIONS_STEP0 } from '../trx/trxHooks.ts';

const QUERY_KEY_GET_ACCOUNTS = 'QUERY_KEY_GET_ACCOUNTS';

export function useGetAccounts() {
  const { updateUserAccounts } = useUserData();

  async function getAccounts() {
    const data = await AccountServices.getAccounts();
    updateUserAccounts(data.data);
    return data.data;
  }

  return useQuery({
    queryKey: [QUERY_KEY_GET_ACCOUNTS],
    queryFn: getAccounts,
    placeholderData: keepPreviousData,
  });
}

export function useRemoveAccount() {
  async function removeAccount(accountId: bigint) {
    const result = await AccountServices.removeAccount(accountId);

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_ACCOUNTS],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_MATRIX],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_IMPORT_TRANSACTIONS_STEP0],
    });
    return result;
  }

  return useMutation({
    mutationFn: removeAccount,
  });
}

export function useAddAccount() {
  async function addAccount(request: AddAccountRequest) {
    const result = await AccountServices.addAccount(request);

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_ACCOUNTS],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_MATRIX],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_IMPORT_TRANSACTIONS_STEP0],
    });
    return result;
  }

  return useMutation({
    mutationFn: addAccount,
  });
}

export function useEditAccount() {
  async function editAccount(request: EditAccountRequest) {
    const result = await AccountServices.editAccount(request);

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_ACCOUNTS],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_MATRIX],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_IMPORT_TRANSACTIONS_STEP0],
    });
    return result;
  }

  return useMutation({
    mutationFn: editAccount,
  });
}

export function useRecalculateAllBalances() {
  async function recalculateAllBalances() {
    const data = await AccountServices.recalculateAllBalances();
    return data.data;
  }

  return useMutation({
    mutationFn: recalculateAllBalances,
  });
}

export function useAutoPopulateWithDemoData() {
  async function autoPopulateWithDemoData() {
    const data = await AccountServices.autoPopulateWithDemoData();
    return data.data;
  }

  return useMutation({
    mutationFn: autoPopulateWithDemoData,
  });
}

export const QUERY_KEY_BALANCE_CHECK = 'QUERY_KEY_BALANCE_CHECK';

export function useGetBalanceCheck() {
  return useQuery({
    queryKey: [QUERY_KEY_BALANCE_CHECK],
    queryFn: async () => (await AccountServices.getBalanceCheck()).data,
  });
}

function invalidateBalanceData() {
  void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_BALANCE_CHECK] });
  void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_GET_ACCOUNTS] });
}

export function useSaveBalanceCheck() {
  return useMutation({
    mutationFn: async (request: { account_id: string; real_balance: number }) => {
      const result = await AccountServices.saveBalanceCheck(request);
      invalidateBalanceData();
      return result.data;
    },
  });
}

export function useWriteOffBalanceGap() {
  return useMutation({
    mutationFn: async (request: { account_id: string; real_balance: number }) => {
      const result = await AccountServices.writeOffBalanceGap(request);
      invalidateBalanceData();
      void queryClient.invalidateQueries({ queryKey: ['QUERY_KEY_GET_TRANSACTIONS'] });
      return result.data;
    },
  });
}
