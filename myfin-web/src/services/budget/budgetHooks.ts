import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../../data/react-query.ts';
import BudgetServices, {
  CreateBudgetRequest,
  CreateBudgetFromTemplateRequest,
  BudgetTemplateRow,
  BudgetTemplateTarget,
  UpdateBudgetRequest,
  UpdateBudgetDescriptionRequest,
  UpdateBudgetMatrixCellRequest,
} from './budgetServices.ts';

export const QUERY_KEY_GET_BUDGETS = 'QUERY_KEY_GET_BUDGETS';
export const QUERY_KEY_GET_BUDGET = 'QUERY_KEY_GET_BUDGET';
const QUERY_KEY_CLONE_BUDGET = 'QUERY_KEY_CLONE_BUDGET';
const QUERY_KEY_CREATE_BUDGET_STEP0 = 'QUERY_KEY_CREATE_BUDGET_STEP0';
export const QUERY_KEY_GET_BUDGET_LIST_SUMMARY = 'QUERY_KEY_GET_BUDGET_LIST_SUMMARY';
export const QUERY_KEY_GET_BUDGET_MATRIX = 'QUERY_KEY_GET_BUDGET_MATRIX';
export const QUERY_KEY_GET_BUDGET_TEMPLATE = 'QUERY_KEY_GET_BUDGET_TEMPLATE';
export const QUERY_KEY_GET_BUDGET_TEMPLATE_SUGGESTIONS =
  'QUERY_KEY_GET_BUDGET_TEMPLATE_SUGGESTIONS';
export function useGetBudgets(
  page: number,
  pageSize: number,
  query?: string,
  status?: 'C' | 'O',
) {
  async function getBudgets() {
    const data = await BudgetServices.getBudgets(page, pageSize, query, status);
    return data.data;
  }

  return useQuery({
    queryKey: [QUERY_KEY_GET_BUDGETS, page, pageSize, query, status],
    queryFn: getBudgets,
    placeholderData: keepPreviousData,
  });
}

export function useRemoveBudget() {
  async function removeBudget(budgetId: bigint) {
    const request = await BudgetServices.removeBudget(budgetId);

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGETS],
    });

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_LIST_SUMMARY],
    });

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_MATRIX],
    });

    return request;
  }

  return useMutation({
    mutationFn: removeBudget,
  });
}

export interface UpdateBudgetStatusParams {
  budgetId: bigint;
  isOpen: boolean;
}

export function useUpdateBudgetStatus() {
  async function updateBudgetStatus({
    budgetId,
    isOpen,
  }: UpdateBudgetStatusParams) {
    const request = await BudgetServices.updateBudgetStatus(budgetId, isOpen);

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_MATRIX],
    });
    return request;
  }

  return useMutation({
    mutationFn: updateBudgetStatus,
  });
}

export function useGetBudget(budgetId: bigint) {
  async function getBudget() {
    const data = await BudgetServices.getBudget(budgetId);
    return {
      ...data.data,
      categories: data.data.categories.map((category) => ({
        ...category,
        /**
         * Cache the initial amounts, so that we can keep item order based off those and not the current amounts,
         * to avoid the items changing order/location at runtime while the user changes input values.
         */
        initial_planned_amount_debit: category.planned_amount_debit,
        initial_planned_amount_credit: category.planned_amount_credit,
      })),
    };
  }

  return useQuery({
    queryKey: [QUERY_KEY_GET_BUDGET, budgetId],
    queryFn: getBudget,
    placeholderData: keepPreviousData,
    enabled: budgetId != -1n,
  });
}

export function useUpdateBudget() {
  async function updateBudget(requestData: UpdateBudgetRequest) {
    const request = await BudgetServices.updateBudget(requestData);

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET],
    });

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_LIST_SUMMARY],
    });

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_MATRIX],
    });

    return request;
  }

  return useMutation({
    mutationFn: updateBudget,
  });
}

export function useCreateBudgetStep0() {
  async function createBudgetStep0() {
    const data = await BudgetServices.createBudgetStep0();
    return data.data;
  }

  return useQuery({
    queryKey: [QUERY_KEY_CREATE_BUDGET_STEP0],
    queryFn: createBudgetStep0,
    placeholderData: keepPreviousData,
    enabled: false,
  });
}

export function useCreateBudgetStep1() {
  async function createBudgetStep1(requestData: CreateBudgetRequest) {
    const request = await BudgetServices.createBudgetStep1(requestData);

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET],
    });

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_LIST_SUMMARY],
    });

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_MATRIX],
    });

    return request.data;
  }

  return useMutation({
    mutationFn: createBudgetStep1,
  });
}

export function useGetBudgetListSummary() {
  async function getBudgetListSummary() {
    const data = await BudgetServices.getBudgetListSummary();
    return data.data;
  }

  return useQuery({
    queryKey: [QUERY_KEY_GET_BUDGET_LIST_SUMMARY],
    queryFn: getBudgetListSummary,
    staleTime: 5 * 60 * 1_000, // 5 minutes
  });
}

export function useGetBudgetToClone(budgetId: bigint | null) {
  async function getBudget() {
    const data = await BudgetServices.getBudget(budgetId || -1n);
    return {
      ...data.data,
      categories: data.data.categories.map((category) => ({
        ...category,
        /**
         * Cache the initial amounts, so that we can keep item order based off those and not the current amounts,
         * to avoid the items changing order/location at runtime while the user changes input values.
         */
        initial_planned_amount_debit: category.planned_amount_debit,
        initial_planned_amount_credit: category.planned_amount_credit,
      })),
    };
  }

  return useQuery({
    queryKey: [QUERY_KEY_CLONE_BUDGET, budgetId],
    queryFn: getBudget,
    placeholderData: keepPreviousData,
    enabled: !!budgetId,
  });
}
export function useGetBudgetMatrix(budgetIds: bigint[]) {
  const normalizedBudgetIds = budgetIds.map((budgetId) => budgetId.toString());

  async function getBudgetMatrix({ signal }: { signal: AbortSignal }) {
    const data = await BudgetServices.getBudgetMatrix(budgetIds, signal);
    return data.data;
  }

  return useQuery({
    queryKey: [QUERY_KEY_GET_BUDGET_MATRIX, normalizedBudgetIds],
    queryFn: getBudgetMatrix,
    placeholderData: keepPreviousData,
    enabled: budgetIds.length > 0,
  });
}

export function useUpdateBudgetMatrixCell() {
  async function updateBudgetMatrixCell(request: UpdateBudgetMatrixCellRequest) {
    const response = await BudgetServices.updateBudgetMatrixCell(request);
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET, request.budget_id],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_MATRIX],
    });
    return response.data;
  }

  return useMutation({
    mutationFn: updateBudgetMatrixCell,
  });
}

export function useUpdateBudgetDescription() {
  async function updateBudgetDescription(request: UpdateBudgetDescriptionRequest) {
    const response = await BudgetServices.updateBudgetDescription(request);
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET, request.budget_id],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_MATRIX],
    });
    return response.data;
  }

  return useMutation({
    mutationFn: updateBudgetDescription,
  });
}

export const QUERY_KEY_GET_BUDGET_TEMPLATES = 'QUERY_KEY_GET_BUDGET_TEMPLATES';

export function useGetBudgetTemplates() {
  async function getBudgetTemplates() {
    const data = await BudgetServices.getBudgetTemplates();
    return data.data;
  }

  return useQuery({
    queryKey: [QUERY_KEY_GET_BUDGET_TEMPLATES],
    queryFn: getBudgetTemplates,
  });
}

/** `templateId` left out: the user's oldest template. */
export function useGetBudgetTemplate(templateId?: number | string) {
  async function getBudgetTemplate() {
    const data = await BudgetServices.getBudgetTemplate(templateId);
    return data.data;
  }

  return useQuery({
    queryKey: [QUERY_KEY_GET_BUDGET_TEMPLATE, templateId ?? 'default'],
    queryFn: getBudgetTemplate,
  });
}

export function useGetBudgetTemplateSuggestions(
  enabled = true,
  templateId?: number | string,
) {
  async function getBudgetTemplateSuggestions() {
    const data = await BudgetServices.getBudgetTemplateSuggestions(templateId);
    return data.data;
  }

  return useQuery({
    queryKey: [
      QUERY_KEY_GET_BUDGET_TEMPLATE_SUGGESTIONS,
      templateId ?? 'default',
    ],
    queryFn: getBudgetTemplateSuggestions,
    enabled,
  });
}

export function invalidateBudgetTemplate() {
  void queryClient.invalidateQueries({
    queryKey: [QUERY_KEY_GET_BUDGET_TEMPLATE],
  });
  void queryClient.invalidateQueries({
    queryKey: [QUERY_KEY_GET_BUDGET_TEMPLATE_SUGGESTIONS],
  });
  void queryClient.invalidateQueries({
    queryKey: [QUERY_KEY_GET_BUDGET_TEMPLATES],
  });
}

export function useCreateBudgetTemplate() {
  async function createBudgetTemplate(name: string) {
    const response = await BudgetServices.createBudgetTemplate(name);
    invalidateBudgetTemplate();
    return response.data;
  }

  return useMutation({ mutationFn: createBudgetTemplate });
}

export function useRenameBudgetTemplate() {
  async function renameBudgetTemplate(request: {
    templateId: number | string;
    name: string;
  }) {
    const response = await BudgetServices.renameBudgetTemplate(
      request.templateId,
      request.name,
    );
    invalidateBudgetTemplate();
    return response.data;
  }

  return useMutation({ mutationFn: renameBudgetTemplate });
}

export function useDeleteBudgetTemplate() {
  async function deleteBudgetTemplate(templateId: number | string) {
    const response = await BudgetServices.deleteBudgetTemplate(templateId);
    invalidateBudgetTemplate();
    return response.data;
  }

  return useMutation({ mutationFn: deleteBudgetTemplate });
}

export function useSaveBudgetTemplate() {
  async function saveBudgetTemplate(request: {
    rows: BudgetTemplateRow[];
    templateId?: number | string;
  }) {
    const response = await BudgetServices.saveBudgetTemplate(
      request.rows,
      request.templateId,
    );
    invalidateBudgetTemplate();
    return response.data;
  }

  return useMutation({
    mutationFn: saveBudgetTemplate,
  });
}

export function useSaveBudgetTemplateFromBudget() {
  async function saveBudgetTemplateFromBudget(request: {
    budgetId: bigint | number;
    target?: BudgetTemplateTarget;
  }) {
    const response = await BudgetServices.saveBudgetTemplateFromBudget(
      request.budgetId,
      request.target,
    );
    invalidateBudgetTemplate();
    return response.data;
  }

  return useMutation({
    mutationFn: saveBudgetTemplateFromBudget,
  });
}

export function useSaveBudgetTemplateFromTypical() {
  async function saveBudgetTemplateFromTypical(target: BudgetTemplateTarget) {
    const response = await BudgetServices.saveBudgetTemplateFromTypical(target);
    invalidateBudgetTemplate();
    return response.data;
  }

  return useMutation({ mutationFn: saveBudgetTemplateFromTypical });
}

export function useSaveBudgetTemplateFromMonth() {
  async function saveBudgetTemplateFromMonth(request: {
    month: number;
    year: number;
    target: BudgetTemplateTarget;
  }) {
    const response = await BudgetServices.saveBudgetTemplateFromMonth(
      { month: request.month, year: request.year },
      request.target,
    );
    invalidateBudgetTemplate();
    return response.data;
  }

  return useMutation({ mutationFn: saveBudgetTemplateFromMonth });
}

export function useCreateBudgetFromTemplate() {
  async function createBudgetFromTemplate(
    request: CreateBudgetFromTemplateRequest,
  ) {
    const response = await BudgetServices.createBudgetFromTemplate(request);

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGETS],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_LIST_SUMMARY],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_MATRIX],
    });

    return response.data;
  }

  return useMutation({
    mutationFn: createBudgetFromTemplate,
  });
}
