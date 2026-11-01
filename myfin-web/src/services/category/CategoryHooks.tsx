import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../../data/react-query.ts';
import {
  QUERY_KEY_GET_BUDGET,
  QUERY_KEY_GET_BUDGET_LIST_SUMMARY,
  QUERY_KEY_GET_BUDGET_MATRIX,
  QUERY_KEY_GET_BUDGETS,
} from '../budget/budgetHooks.ts';
import { QUERY_KEY_GET_EVENTS } from '../events/eventHooks.ts';
import { QUERY_KEY_GET_PLANNED } from '../planned/plannedHooks.ts';
import { QUERY_KEY_GET_RULES } from '../rule/ruleHooks.tsx';
import { QUERY_KEY_GET_TRANSACTIONS } from '../trx/trxHooks.ts';
import CategoryServices, {
  AddCategoryRequest,
  EditCategoryRequest,
} from './categoryServices.ts';

const QUERY_KEY_GET_CATEGORIES = 'QUERY_KEY_GET_CATEGORIES';

export function useGetCategories() {
  async function getCategories() {
    const data = await CategoryServices.getCategories();
    return data.data;
  }

  return useQuery({
    queryKey: [QUERY_KEY_GET_CATEGORIES],
    queryFn: getCategories,
    placeholderData: keepPreviousData,
  });
}

export function useRemoveCategory() {
  async function removeCategory(CategoryId: bigint) {
    const result = await CategoryServices.removeCategory(CategoryId);

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_CATEGORIES],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_MATRIX],
    });
    return result;
  }

  return useMutation({
    mutationFn: removeCategory,
  });
}

export function useAddCategory() {
  async function addCategory(request: AddCategoryRequest) {
    const result = await CategoryServices.addCategory(request);

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_CATEGORIES],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_MATRIX],
    });
    return result;
  }

  return useMutation({
    mutationFn: addCategory,
  });
}

export function useEditCategory() {
  async function editCategory(request: EditCategoryRequest) {
    const result = await CategoryServices.editCategory(request);

    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_CATEGORIES],
    });
    void queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_GET_BUDGET_MATRIX],
    });
    return result;
  }

  return useMutation({
    mutationFn: editCategory,
  });
}

export function useMergeCategories() {
  async function mergeCategories(request: {
    sourceId: bigint;
    targetId: bigint;
  }) {
    const result = await CategoryServices.mergeCategories(
      request.sourceId,
      request.targetId,
    );

    // Transactions, rules, events, planned items and budget amounts all move.
    for (const key of [
      QUERY_KEY_GET_CATEGORIES,
      QUERY_KEY_GET_BUDGET_MATRIX,
      QUERY_KEY_GET_BUDGETS,
      QUERY_KEY_GET_BUDGET,
      QUERY_KEY_GET_BUDGET_LIST_SUMMARY,
      QUERY_KEY_GET_TRANSACTIONS,
      QUERY_KEY_GET_RULES,
      QUERY_KEY_GET_EVENTS,
      QUERY_KEY_GET_PLANNED,
    ]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    return result;
  }

  return useMutation({
    mutationFn: mergeCategories,
  });
}
