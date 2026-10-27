import { useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../../data/react-query.ts';
import {
  QUERY_KEY_GET_DAILY_SPEND,
  QUERY_KEY_GET_EMERGENCY_FUND,
  QUERY_KEY_GET_FORECAST,
  QUERY_KEY_GET_MONTH_INSIGHTS,
  QUERY_KEY_GET_SAFE_TO_SPEND,
  QUERY_KEY_GET_SMALL_SPENDS,
} from '../insights/insightsHooks.ts';
import { QUERY_KEY_GET_TRANSACTIONS } from '../trx/trxHooks.ts';
import {
  QUERY_KEY_GET_DEBTS,
  QUERY_KEY_GET_REPAYMENT_SUGGESTIONS,
} from './debtQueryKeys.ts';
import debtServices, {
  DebtUpdateInput,
  PeopleDebtInput,
  RepaymentInput,
} from './debtServices.ts';

export { QUERY_KEY_GET_DEBTS, QUERY_KEY_GET_REPAYMENT_SUGGESTIONS };

// Linking rows to debts changes what counts as spending and income
const invalidateAll = () => {
  for (const key of [
    QUERY_KEY_GET_DEBTS,
    QUERY_KEY_GET_REPAYMENT_SUGGESTIONS,
    QUERY_KEY_GET_MONTH_INSIGHTS,
    QUERY_KEY_GET_SAFE_TO_SPEND,
    QUERY_KEY_GET_SMALL_SPENDS,
    QUERY_KEY_GET_DAILY_SPEND,
    QUERY_KEY_GET_EMERGENCY_FUND,
    QUERY_KEY_GET_FORECAST,
    QUERY_KEY_GET_TRANSACTIONS,
  ])
    void queryClient.invalidateQueries({ queryKey: [key] });
};

export function useGetDebts() {
  return useQuery({
    queryKey: [QUERY_KEY_GET_DEBTS],
    queryFn: async () => (await debtServices.getDebts()).data,
  });
}

export function useGetRepaymentSuggestions(id: string | null) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_REPAYMENT_SUGGESTIONS, id],
    queryFn: async () =>
      (await debtServices.getRepaymentSuggestions(id as string)).data,
    enabled: id !== null,
  });
}

export function useCreateDebt() {
  return useMutation({
    mutationFn: async (input: PeopleDebtInput) =>
      (await debtServices.createDebt(input)).data,
    onSuccess: invalidateAll,
  });
}

export function useUpdateDebt() {
  return useMutation({
    mutationFn: async (input: { id: string; data: DebtUpdateInput }) =>
      (await debtServices.updateDebt(input.id, input.data)).data,
    onSuccess: invalidateAll,
  });
}

export function useDeleteDebt() {
  return useMutation({
    mutationFn: async (id: string) => (await debtServices.deleteDebt(id)).data,
    onSuccess: invalidateAll,
  });
}

export function useAddRepayment() {
  return useMutation({
    mutationFn: async (input: { id: string; data: RepaymentInput }) =>
      (await debtServices.addRepayment(input.id, input.data)).data,
    onSuccess: invalidateAll,
  });
}

export function useDeleteRepayment() {
  return useMutation({
    mutationFn: async (input: { id: string; paymentId: string }) =>
      (await debtServices.deleteRepayment(input.id, input.paymentId)).data,
    onSuccess: invalidateAll,
  });
}
