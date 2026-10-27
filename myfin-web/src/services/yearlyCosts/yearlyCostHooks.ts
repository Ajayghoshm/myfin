import { useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../../data/react-query.ts';
import {
  QUERY_KEY_GET_MONTH_INSIGHTS,
  QUERY_KEY_GET_SAFE_TO_SPEND,
} from '../insights/insightsHooks.ts';
import { QUERY_KEY_GET_TRANSACTIONS } from '../trx/trxHooks.ts';
import yearlyCostServices, { YearlyCostInput } from './yearlyCostServices.ts';

export const QUERY_KEY_GET_YEARLY_COSTS = 'QUERY_KEY_GET_YEARLY_COSTS';
export const QUERY_KEY_GET_YEARLY_COST_SUGGESTIONS =
  'QUERY_KEY_GET_YEARLY_COST_SUGGESTIONS';
export const QUERY_KEY_GET_YEARLY_COST_CANDIDATES =
  'QUERY_KEY_GET_YEARLY_COST_CANDIDATES';

const invalidateAll = () => {
  for (const key of [
    QUERY_KEY_GET_YEARLY_COSTS,
    QUERY_KEY_GET_YEARLY_COST_SUGGESTIONS,
    QUERY_KEY_GET_YEARLY_COST_CANDIDATES,
    QUERY_KEY_GET_MONTH_INSIGHTS,
    QUERY_KEY_GET_SAFE_TO_SPEND,
    QUERY_KEY_GET_TRANSACTIONS,
  ])
    void queryClient.invalidateQueries({ queryKey: [key] });
};

export function useGetYearlyCosts() {
  return useQuery({
    queryKey: [QUERY_KEY_GET_YEARLY_COSTS],
    queryFn: async () => (await yearlyCostServices.getYearlyCosts()).data,
  });
}

export function useGetYearlyCostSuggestions() {
  return useQuery({
    queryKey: [QUERY_KEY_GET_YEARLY_COST_SUGGESTIONS],
    queryFn: async () => (await yearlyCostServices.getSuggestions()).data,
  });
}

export function useGetYearlyCostCandidates(id: string | null) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_YEARLY_COST_CANDIDATES, id],
    queryFn: async () =>
      (await yearlyCostServices.getCandidates(id as string)).data,
    enabled: id !== null,
  });
}

export function useSaveYearlyCost() {
  return useMutation({
    mutationFn: async (input: { id: string | null; data: YearlyCostInput }) =>
      (input.id === null
        ? await yearlyCostServices.createYearlyCost(input.data)
        : await yearlyCostServices.updateYearlyCost(input.id, input.data)
      ).data,
    onSuccess: invalidateAll,
  });
}

export function useDeleteYearlyCost() {
  return useMutation({
    mutationFn: async (id: string) =>
      (await yearlyCostServices.deleteYearlyCost(id)).data,
    onSuccess: invalidateAll,
  });
}

export function useDismissYearlyCostSuggestion() {
  return useMutation({
    mutationFn: async (payeeKey: string) =>
      (await yearlyCostServices.dismissSuggestion(payeeKey)).data,
    onSuccess: invalidateAll,
  });
}

export function useLinkYearlyCostTransaction() {
  return useMutation({
    mutationFn: async (input: {
      transactionId: string;
      yearlyCostId: string | null;
    }) =>
      (
        await yearlyCostServices.linkTransaction(
          input.transactionId,
          input.yearlyCostId,
        )
      ).data,
    onSuccess: invalidateAll,
  });
}
