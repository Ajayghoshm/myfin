import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createFilterOptions, FilterOptionsState } from '@mui/material';
import { IdLabelPair } from '../features/transactions/AddEditTransactionDialog.tsx';
import { useAddCategory } from '../services/category/CategoryHooks.tsx';
import { useAddEntity } from '../services/entity/entityHooks.ts';
import { CategoryStatus } from '../services/category/categoryServices.ts';
import { ColorGradient } from '../consts/index.ts';
import { AlertSeverity, useSnackbar } from '../providers/SnackbarProvider.tsx';

export type CreatableKind = 'category' | 'entity';

/** An option that, when picked, creates a new category/entity named `createName`. */
export type CreatableOption = IdLabelPair & { createName?: string };

const defaultFilterOptions = createFilterOptions<CreatableOption>();

// placeholder id for the "+ Add" option; distinct from -1n, which some pickers use for "ignore"
const CREATE_OPTION_ID = -9999n;

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Lets a category or entity Autocomplete create a missing item from what was typed:
 * spread `filterOptions` into the Autocomplete, pass picked values through `resolve`,
 * and wrap the option list with `withCreated` so newly created items stay listed.
 */
export function useCreatableOptions(kind: CreatableKind) {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const addCategoryRequest = useAddCategory();
  const addEntityRequest = useAddEntity();
  const [created, setCreated] = useState<IdLabelPair[]>([]);

  const withCreated = <T extends IdLabelPair>(options: T[]): (T | IdLabelPair)[] => [
    ...options,
    ...created.filter(
      (item) => !options.some((option) => String(option.id) === String(item.id)),
    ),
  ];

  const filterOptions = (
    options: CreatableOption[],
    state: FilterOptionsState<CreatableOption>,
  ): CreatableOption[] => {
    const filtered = defaultFilterOptions(options, state);
    const typed = state.inputValue.trim();
    if (typed && !options.some((option) => sameName(option.label, typed))) {
      filtered.push({
        id: CREATE_OPTION_ID,
        label: t('common.addNamed', { name: typed }),
        createName: typed,
      });
    }
    return filtered;
  };

  /**
   * Returns the option to select: the picked one, an existing one with the same name,
   * or a newly created one. Returns undefined if creating failed (keep the old value).
   */
  const resolve = async (
    value: CreatableOption | null,
    options: IdLabelPair[],
  ): Promise<IdLabelPair | null | undefined> => {
    if (!value?.createName) return value;
    const name = value.createName;
    const existing = withCreated(options).find((option) => sameName(option.label, name));
    if (existing) return existing;
    try {
      let option: IdLabelPair;
      if (kind === 'category') {
        const result = await addCategoryRequest.mutateAsync({
          name,
          color_gradient: Object.values(ColorGradient)[0],
          status: CategoryStatus.Active,
          exclude_from_budgets: false,
        });
        option = { id: BigInt(result.data.category_id), label: result.data.name };
      } else {
        const result = await addEntityRequest.mutateAsync({ name });
        option = { id: BigInt(result.data.entity_id), label: result.data.name };
      }
      setCreated((items) => [...items, option]);
      return option;
    } catch {
      snackbar.showSnackbar(t('common.somethingWentWrongTryAgain'), AlertSeverity.ERROR);
      return undefined;
    }
  };

  return { filterOptions, resolve, withCreated, created };
}
