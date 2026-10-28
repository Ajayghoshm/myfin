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

export const QUERY_KEY_GET_HEALTH = 'QUERY_KEY_GET_HEALTH';

/** `ym` is 'YYYY-MM'; omitted = the current month. */
export function useGetHealth(ym?: string, enabled = true) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_HEALTH, ym ?? 'current'],
    queryFn: async () => (await insightsServices.getHealth(ym)).data,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export const QUERY_KEY_GET_HEALTH_HISTORY = 'QUERY_KEY_GET_HEALTH_HISTORY';

export function useGetHealthHistory() {
  return useQuery({
    queryKey: [QUERY_KEY_GET_HEALTH_HISTORY],
    queryFn: async () => (await insightsServices.getHealthHistory()).data,
  });
}

export const QUERY_KEY_GET_REVIEW = 'QUERY_KEY_GET_REVIEW';

/** `ym` is 'YYYY-MM'; omitted = the previous month. */
export function useGetReview(ym?: string, enabled = true) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_REVIEW, ym ?? 'previous'],
    queryFn: async () => (await insightsServices.getReview(ym)).data,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export const QUERY_KEY_GET_REVIEW_HISTORY = 'QUERY_KEY_GET_REVIEW_HISTORY';

export function useGetReviewHistory() {
  return useQuery({
    queryKey: [QUERY_KEY_GET_REVIEW_HISTORY],
    queryFn: async () => (await insightsServices.getReviewHistory()).data,
  });
}

export function useSetReviewed() {
  return useMutation({
    mutationFn: async (input: { month: string; reviewed: boolean }) =>
      (await insightsServices.setReviewed(input.month, input.reviewed)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [QUERY_KEY_GET_REVIEW],
      });
      void queryClient.invalidateQueries({
        queryKey: [QUERY_KEY_GET_REVIEW_HISTORY],
      });
    },
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

export const QUERY_KEY_GET_NET_WORTH = 'QUERY_KEY_GET_NET_WORTH';

/** `ym` is 'YYYY-MM'. */
export function useGetNetWorth(ym: string) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_NET_WORTH, ym],
    queryFn: async () => (await insightsServices.getNetWorth(ym)).data,
    placeholderData: keepPreviousData,
  });
}

export const QUERY_KEY_GET_DAILY_SPEND = 'QUERY_KEY_GET_DAILY_SPEND';

export function useGetDailySpend(
  from: string,
  to: string,
  flexibleOnly: boolean,
) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_DAILY_SPEND, from, to, flexibleOnly],
    queryFn: async () =>
      (await insightsServices.getDailySpend(from, to, flexibleOnly)).data,
    placeholderData: keepPreviousData,
  });
}

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
