import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../../data/react-query.ts';
import { QUERY_KEY_GET_FINANCIAL_PROFILE } from '../profile/financialProfileHooks.ts';
import retirementServices, {
  RetirementOverrides,
} from './retirementServices.ts';

export const QUERY_KEY_GET_RETIREMENT = 'QUERY_KEY_GET_RETIREMENT';
export const QUERY_KEY_GET_RETIREMENT_WHAT_IF =
  'QUERY_KEY_GET_RETIREMENT_WHAT_IF';

export function useGetRetirement() {
  return useQuery({
    queryKey: [QUERY_KEY_GET_RETIREMENT],
    queryFn: async () => (await retirementServices.getRetirement()).data,
  });
}

/** Runs only once `overrides` is set (the user has moved a slider). */
export function useRetirementWhatIf(overrides: RetirementOverrides | null) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_RETIREMENT_WHAT_IF, overrides],
    queryFn: async () =>
      (await retirementServices.whatIf(overrides ?? {})).data,
    enabled: overrides !== null,
    placeholderData: keepPreviousData,
  });
}

export function useSaveRetirementWhatIf() {
  return useMutation({
    mutationFn: async (overrides: RetirementOverrides) =>
      (await retirementServices.saveWhatIf(overrides)).data,
    onSuccess: () => {
      for (const key of [
        QUERY_KEY_GET_RETIREMENT,
        QUERY_KEY_GET_RETIREMENT_WHAT_IF,
        QUERY_KEY_GET_FINANCIAL_PROFILE,
      ])
        void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}
