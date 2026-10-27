import { useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../../data/react-query.ts';
import { QUERY_KEY_GET_MONTH_INSIGHTS } from '../insights/insightsHooks.ts';
import { QUERY_KEY_GET_TRANSACTIONS } from '../trx/trxHooks.ts';
import financialProfileServices, {
  FinancialProfilePatch,
} from './financialProfileServices.ts';

export const QUERY_KEY_GET_FINANCIAL_PROFILE =
  'QUERY_KEY_GET_FINANCIAL_PROFILE';

export function useGetFinancialProfile() {
  async function getFinancialProfile() {
    const response = await financialProfileServices.getFinancialProfile();
    return response.data;
  }

  return useQuery({
    queryKey: [QUERY_KEY_GET_FINANCIAL_PROFILE],
    queryFn: getFinancialProfile,
  });
}

export function useUpdateFinancialProfile() {
  async function updateFinancialProfile(patch: FinancialProfilePatch) {
    const response =
      await financialProfileServices.updateFinancialProfile(patch);
    return response.data;
  }

  return useMutation({
    mutationFn: updateFinancialProfile,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [QUERY_KEY_GET_FINANCIAL_PROFILE],
      });
      void queryClient.invalidateQueries({
        queryKey: [QUERY_KEY_GET_MONTH_INSIGHTS],
      });
      void queryClient.invalidateQueries({
        queryKey: [QUERY_KEY_GET_TRANSACTIONS],
      });
    },
  });
}
