import { useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../../data/react-query.ts';
import milestoneServices from './milestoneServices.ts';

export const QUERY_KEY_EVALUATE_MILESTONES = 'QUERY_KEY_EVALUATE_MILESTONES';
export const QUERY_KEY_GET_MILESTONES = 'QUERY_KEY_GET_MILESTONES';

/**
 * Evaluates milestones for the Dashboard banner: at most once per mount, and a remount within 5
 * minutes reuses the result. Never refetched in the background or retried.
 */
export function useEvaluateMilestones() {
  return useQuery({
    queryKey: [QUERY_KEY_EVALUATE_MILESTONES],
    queryFn: async () => (await milestoneServices.evaluateMilestones()).data,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}

export function useGetMilestones() {
  return useQuery({
    queryKey: [QUERY_KEY_GET_MILESTONES],
    queryFn: async () => (await milestoneServices.getMilestones()).data,
  });
}

export function useDismissMilestone() {
  return useMutation({
    mutationFn: async (id: string) =>
      (await milestoneServices.dismissMilestone(id)).data,
    onSuccess: (dismissed) => {
      queryClient.setQueryData<{ milestone_id: string }[]>(
        [QUERY_KEY_EVALUATE_MILESTONES],
        (list) =>
          list?.filter((m) => m.milestone_id !== dismissed.milestone_id),
      );
      void queryClient.invalidateQueries({
        queryKey: [QUERY_KEY_GET_MILESTONES],
      });
    },
  });
}
