import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../../data/react-query.ts';
import { parseYearMonth } from '../../utils/istMonth.ts';
import insightsServices, {
  ForecastBudgetMode,
  PayeeKind,
} from './insightsServices.ts';

export const QUERY_KEY_GET_MONTH_INSIGHTS = 'QUERY_KEY_GET_MONTH_INSIGHTS';

export const QUERY_KEY_GET_EMERGENCY_FUND = 'QUERY_KEY_GET_EMERGENCY_FUND';

export function useGetEmergencyFund() {
  return useQuery({
    queryKey: [QUERY_KEY_GET_EMERGENCY_FUND],
    queryFn: async () => (await insightsServices.getEmergencyFund()).data,
  });
}

export const QUERY_KEY_GET_SAFE_TO_SPEND = 'QUERY_KEY_GET_SAFE_TO_SPEND';

export function useGetSafeToSpend() {
  return useQuery({
    queryKey: [QUERY_KEY_GET_SAFE_TO_SPEND],
    queryFn: async () => (await insightsServices.getSafeToSpend()).data,
  });
}

export const QUERY_KEY_GET_SMALL_SPENDS = 'QUERY_KEY_GET_SMALL_SPENDS';

/** `ym` is 'YYYY-MM'. */
export function useGetSmallSpends(ym: string) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_SMALL_SPENDS, ym],
    queryFn: async () => (await insightsServices.getSmallSpends(ym)).data,
    placeholderData: keepPreviousData,
  });
}

/** `ym` is 'YYYY-MM'. */
export function useGetMonthInsights(ym: string) {
  async function getMonthInsights() {
    const { year, month } = parseYearMonth(ym);
    const response = await insightsServices.getMonthInsights(year, month);
    return response.data;
  }

  return useQuery({
    queryKey: [QUERY_KEY_GET_MONTH_INSIGHTS, ym],
    queryFn: getMonthInsights,
    placeholderData: keepPreviousData,
  });
}

export function useSetPayeeClassification() {
  async function setPayeeClassification(input: {
    payee_key: string;
    kind: PayeeKind | null;
  }) {
    const response = await insightsServices.setPayeeClassification(
      input.payee_key,
      input.kind,
    );
    return response.data;
  }

  return useMutation({
    mutationFn: setPayeeClassification,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [QUERY_KEY_GET_MONTH_INSIGHTS],
      });
    },
  });
}

export const QUERY_KEY_GET_FORECAST = 'QUERY_KEY_GET_FORECAST';

export function useGetForecast(month: string) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_FORECAST, month],
    queryFn: async () => (await insightsServices.getForecast(month)).data,
  });
}

export function useGetForecastBudgetCompare(month: string, enabled: boolean) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_FORECAST, 'compare', month],
    queryFn: async () =>
      (await insightsServices.getForecastBudgetCompare(month)).data,
    enabled,
    gcTime: 0,
  });
}

export function useCreateBudgetFromForecast() {
  return useMutation({
    mutationFn: async (input: { month: string; mode: ForecastBudgetMode }) =>
      (await insightsServices.createBudgetFromForecast(input.month, input.mode))
        .data,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (q) =>
          String(q.queryKey[0]).startsWith('QUERY_KEY_GET_BUDGET') ||
          q.queryKey[0] === QUERY_KEY_GET_FORECAST,
      });
    },
  });
}
