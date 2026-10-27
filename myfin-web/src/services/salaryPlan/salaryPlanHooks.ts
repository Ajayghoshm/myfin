import { useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../../data/react-query.ts';
import salaryPlanServices, {
  ConfirmSalaryPlanInput,
} from './salaryPlanServices.ts';

export const QUERY_KEY_GET_SALARY_PLAN = 'QUERY_KEY_GET_SALARY_PLAN';
// Same value as QUERY_KEY_GET_PLANNED (plannedHooks imports this file, so it cannot be imported back)
const QUERY_KEY_PLANNED = 'QUERY_KEY_GET_PLANNED';

export function useGetCurrentSalaryPlan() {
  return useQuery({
    queryKey: [QUERY_KEY_GET_SALARY_PLAN, 'current'],
    queryFn: async () => (await salaryPlanServices.getCurrent()).data,
  });
}

export function useGetSalaryPlan(month: string | undefined) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_SALARY_PLAN, month],
    queryFn: async () =>
      (await salaryPlanServices.getByMonth(month as string)).data,
    enabled: Boolean(month),
    retry: false,
  });
}

export function useConfirmSalaryPlan() {
  return useMutation({
    mutationFn: async (input: ConfirmSalaryPlanInput) =>
      (await salaryPlanServices.confirm(input)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [QUERY_KEY_GET_SALARY_PLAN],
      });
      void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_PLANNED] });
    },
  });
}
