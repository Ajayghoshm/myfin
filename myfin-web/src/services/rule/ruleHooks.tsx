import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../../data/react-query.ts';
import { QUERY_KEY_GET_TRANSACTIONS } from '../trx/trxHooks.ts';
import ruleServices, { Rule } from './ruleServices.tsx';

export const QUERY_KEY_GET_RULES = 'QUERY_KEY_GET_RULES';

export function useGetRules() {
  async function getRules() {
    const data = await ruleServices.getRules();
    return data.data;
  }

  return useQuery({
    queryKey: [QUERY_KEY_GET_RULES],
    queryFn: getRules,
    placeholderData: keepPreviousData,
  });
}

export function useRemoveRule() {
  async function removeRule(ruleId: bigint) {
    const result = await ruleServices.removeRule(ruleId);

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_RULES],
    });
    return result;
  }

  return useMutation({
    mutationFn: removeRule,
  });
}

export function useAddRule() {
  async function addRule(request: Partial<Rule>) {
    const result = await ruleServices.addRule(request);

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_RULES],
    });
    return result;
  }

  return useMutation({
    mutationFn: addRule,
  });
}

export function useEditRule() {
  async function editRule(request: Rule) {
    const result = await ruleServices.editRule(request);

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_RULES],
    });
    return result;
  }

  return useMutation({
    mutationFn: editRule,
  });
}

export function useRuleApplyPreview(enabled: boolean) {
  async function previewApplyRules() {
    const data = await ruleServices.previewApplyRules();
    return data.data;
  }

  // Always fresh: the preview depends on the rules and transactions as they are now
  return useQuery({
    queryKey: ['QUERY_KEY_RULE_APPLY_PREVIEW'],
    queryFn: previewApplyRules,
    enabled,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useApplyRules() {
  async function applyRules(transactionIds: string[]) {
    const data = await ruleServices.applyRules(transactionIds);
    return data.data;
  }

  return useMutation({
    mutationFn: applyRules,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [QUERY_KEY_GET_TRANSACTIONS],
      });
    },
  });
}
