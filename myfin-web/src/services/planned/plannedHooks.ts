import { useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../../data/react-query.ts';
import {
  QUERY_KEY_BALANCE_CHECK,
  QUERY_KEY_GET_ACCOUNTS,
} from '../account/accountHooks.ts';
import { QUERY_KEY_GET_BUDGET_MATRIX } from '../budget/budgetHooks.ts';
import {
  QUERY_KEY_GET_EMERGENCY_FUND,
  QUERY_KEY_GET_FORECAST,
  QUERY_KEY_GET_MONTH_INSIGHTS,
  QUERY_KEY_GET_SAFE_TO_SPEND,
} from '../insights/insightsHooks.ts';
import { QUERY_KEY_GET_SALARY_PLAN } from '../salaryPlan/salaryPlanHooks.ts';
import { QUERY_KEY_GET_TRANSACTIONS } from '../trx/trxHooks.ts';
import { QUERY_KEY_GET_YEARLY_COSTS } from '../yearlyCosts/yearlyCostHooks.ts';
import plannedServices from './plannedServices.ts';

export const QUERY_KEY_GET_PLANNED = 'QUERY_KEY_GET_PLANNED';
const QUERY_KEY_GET_PLANNED_CANDIDATES = 'QUERY_KEY_GET_PLANNED_CANDIDATES';

const invalidateAll = () => {
  for (const key of [
    QUERY_KEY_GET_PLANNED,
    QUERY_KEY_GET_PLANNED_CANDIDATES,
    QUERY_KEY_GET_TRANSACTIONS,
    QUERY_KEY_GET_MONTH_INSIGHTS,
    QUERY_KEY_GET_SAFE_TO_SPEND,
    QUERY_KEY_GET_SALARY_PLAN,
    QUERY_KEY_GET_EMERGENCY_FUND,
    QUERY_KEY_GET_YEARLY_COSTS,
    QUERY_KEY_GET_FORECAST,
    QUERY_KEY_GET_ACCOUNTS,
    QUERY_KEY_BALANCE_CHECK,
    QUERY_KEY_GET_BUDGET_MATRIX,
  ])
    void queryClient.invalidateQueries({ queryKey: [key] });
};

export function useGetPlanned(enabled = true) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_PLANNED],
    queryFn: async () => (await plannedServices.getPlanned()).data,
    enabled,
  });
}

export function useGetPlannedMatches(transactionIds: string[]) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_PLANNED, 'matches', transactionIds],
    queryFn: () => plannedServices.getMatches(transactionIds),
    enabled: transactionIds.length > 0,
    // matches are a one-time offer for just-created rows
    staleTime: Infinity,
    gcTime: 0,
    retry: 1,
  });
}

export function useGetPlannedCandidates(plannedId: string | null) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_PLANNED_CANDIDATES, plannedId],
    queryFn: async () =>
      (await plannedServices.getCandidates(plannedId as string)).data,
    enabled: plannedId !== null,
  });
}

export function useMarkPlannedDone() {
  return useMutation({
    mutationFn: async (plannedId: string) =>
      (await plannedServices.markDone(plannedId)).data,
    onSuccess: invalidateAll,
  });
}

export function useSkipPlanned() {
  return useMutation({
    mutationFn: async (plannedId: string) =>
      (await plannedServices.skip(plannedId)).data,
    onSuccess: invalidateAll,
  });
}

export function useConfirmPlannedMatch() {
  return useMutation({
    mutationFn: async (input: { plannedId: string; transactionId: string }) =>
      (await plannedServices.confirmMatch(input.plannedId, input.transactionId))
        .data,
    onSuccess: invalidateAll,
  });
}
