import { KeyboardDoubleArrowRight } from '@mui/icons-material';
import {
  CreatableOption,
  useCreatableOptions,
} from '../../../components/useCreatableOptions.ts';
import Button from '@mui/material/Button';
import { Trans, useTranslation } from 'react-i18next';
import { memo, useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useLoading } from '../../../providers/LoadingProvider.tsx';
import {
  AlertSeverity,
  useSnackbar,
} from '../../../providers/SnackbarProvider.tsx';
import {
  Autocomplete,
  Checkbox,
  FilterOptionsState,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import Grid from '@mui/material/Grid';
import { IdLabelPair } from '../AddEditTransactionDialog.tsx';
import MyFinStaticTable from '../../../components/MyFinStaticTable.tsx';
import { DatePicker } from '@mui/x-date-pickers';
import {
  convertDayJsToUnixTimestamp,
  convertUnixTimestampToDayJs,
} from '../../../utils/dateUtils.ts';
import dayjs from 'dayjs';
import { ImportTrxStep1Result } from './ImportTrxStep1.tsx';
import GenericConfirmationDialog from '../../../components/GenericConfirmationDialog.tsx';
import { useImportTransactionsStep2 } from '../../../services/trx/trxHooks.ts';
import { inferTrxTypeByAttributes } from '../../../utils/transactionUtils.ts';
import { TransactionType } from '../../../services/trx/trxServices.ts';
import ImportTrxStep2PayeeGroups from './ImportTrxStep2PayeeGroups.tsx';
import {
  buildPayeeGroups,
  fillBlankRows,
  GroupPatch,
  PayeeGroup,
  toPayeeRules,
} from './payeeGroups.ts';
import ImportTrxStep2AccountsCell from './ImportTrxStep2AccountsCell.tsx';
import { useFormatNumberAsCurrency } from '../../../utils/textHooks.ts';

export type Props = {
  data: ImportTrxStep1Result;
  onNext: (result: ImportTrxStep2Result) => void;
};

type ImportedTrx = {
  tempId: number;
  selected: boolean;
  date: number;
  description: string;
  value: number;
  entity?: IdLabelPair;
  category?: IdLabelPair;
  accountFrom?: IdLabelPair;
  accountTo?: IdLabelPair;
  essential: boolean;
  externalId?: string;
  // PhonePe only: set when the row has a payee that rows can be grouped by
  type?: TransactionType;
  payee?: string | null;
  payeeMatch?: string | null;
  payeeMatchExact?: boolean;
};

export type ImportTrxStep2Result = {
  nrOfTrxImported: number;
  accountName: string;
};

const DescriptionCell = memo(
  ({
     id,
    description,
    onInputChange,
    onBlur,
  }: {
    id: number;
    description: string;
    onInputChange: (id: number, input: string) => void;
    onBlur: (id: number, value: string) => void;
  }) => {
    const [localValue, setLocalValue] = useState(description);

    useEffect(() => {
      setLocalValue(description);
    }, [description]);

    return (
      <TextField
        margin="dense"
        id="description"
        name="description"
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value);
          onInputChange(id, e.target.value);
        }}
        onBlur={() => {
          onBlur(id, localValue);
        }}
        onKeyUp={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        type="text"
        fullWidth
        variant="outlined"
      />
    );
  },
);

DescriptionCell.displayName = 'DescriptionCell';

const DateCell = memo(
  ({
     id,
     value,
     onChange,
   }: {
    id: number;
    value: number;
    onChange: (id: number, timestamp: number) => void;
  }) => (
    <DatePicker
      name="date"
      value={convertUnixTimestampToDayJs(value)}
      onChange={(newValue) => {
        const timestamp = convertDayJsToUnixTimestamp(newValue || dayjs());
        onChange(id, timestamp);
      }}
      format="DD/MM/YYYY"
      slotProps={{
        textField: {
          variant: 'outlined',
          required: true,
          fullWidth: true,
          margin: 'dense',
        },
        inputAdornment: {
          position: 'start',
        },
      }}
    />
  ),
);
DateCell.displayName = 'DateCell';

const ValueCell = memo(
  ({
     id,
     value,
     onDebouncedChange,
   }: {
    id: number;
    value: number;
    onDebouncedChange: (id: number, value: number) => void;
  }) => {
    const [localValue, setLocalValue] = useState(value);

    useEffect(() => {
      setLocalValue(value);
    }, [value]);

    return (
      <TextField
        margin="dense"
        id="amount"
        name="amount"
        value={localValue}
        onChange={(e) => {
          const newValue = Number(e.target.value);
          setLocalValue(newValue);
          onDebouncedChange(id, newValue);
        }}
        type="number"
        fullWidth
        variant="outlined"
        slotProps={{
          htmlInput: {
            step: 0.01,
          },
        }}
      />
    );
  },
);
ValueCell.displayName = 'ValueCell';

type CreatableOptionsFilter = (
  options: CreatableOption[],
  state: FilterOptionsState<CreatableOption>,
) => CreatableOption[];

const CategoryCell = memo(
  ({
     id,
     category,
     entity,
     categories,
     entities,
     filterCategoryOptions,
     filterEntityOptions,
     onCategoryChange,
     onEntityChange,
   }: {
    id: number;
    category: IdLabelPair | undefined;
    entity: IdLabelPair | undefined;
    categories: CreatableOption[];
    entities: CreatableOption[];
    filterCategoryOptions: CreatableOptionsFilter;
    filterEntityOptions: CreatableOptionsFilter;
    onCategoryChange: (id: number, value: CreatableOption | null) => void;
    onEntityChange: (id: number, value: CreatableOption | null) => void;
  }) => {
    const { t } = useTranslation();
    return (
      <Stack spacing={2} sx={{ mt: 2, mb: 2, width: 1 }}>
        <Autocomplete
          id="category"
          fullWidth
          value={category ?? null}
          onChange={(_event, value) => onCategoryChange(id, value)}
          options={categories}
          filterOptions={filterCategoryOptions}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          renderInput={(params) => (
            <TextField
              {...params}
              label={t('transactions.category')}
              fullWidth
              onKeyDown={(e) => e.stopPropagation()}
            />
          )}
        />
        <Autocomplete
          id="entity"
          fullWidth
          value={entity ?? null}
          onChange={(_event, value) => onEntityChange(id, value)}
          options={entities}
          filterOptions={filterEntityOptions}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          renderInput={(params) => (
            <TextField
              {...params}
              label={t('transactions.entity')}
              fullWidth
              onKeyDown={(e) => e.stopPropagation()}
            />
          )}
        />
      </Stack>
    );
  },
);
CategoryCell.displayName = 'CategoryCell';

const CheckboxCell = memo(
  ({
    id,
    checked,
    disabled = false,
    onChange,
  }: {
    id: number;
    checked: boolean;
    disabled?: boolean;
    onChange: (id: number, checked: boolean) => void;
  }) => (
    <Checkbox
      checked={checked}
      disabled={disabled}
      onChange={(_, checked) => onChange(id, checked)}
      inputProps={{ 'aria-label': 'controlled' }}
    />
  ),
);
CheckboxCell.displayName = 'CheckboxCell';

const canMarkAsEssential = (trx: Pick<ImportedTrx, 'accountFrom' | 'accountTo'>) =>
  !!trx.accountFrom && !trx.accountTo;

const toFiniteNumber = (value: unknown): number => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const ImportTrxStep2 = (props: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const loader = useLoading();
  const snackbar = useSnackbar();

  const importTrxStep2Request = useImportTransactionsStep2();
  const categoryCreate = useCreatableOptions('category');
  const entityCreate = useCreatableOptions('entity');
  const formatNumberAsCurrency = useFormatNumberAsCurrency();
  const [isConfirmationDialogOpen, setConfirmationDialogOpen] = useState(false);
  const [transactions, setTransactions] = useState<ImportedTrx[]>([]);
  const [groupByPayee, setGroupByPayee] = useState(false);
  // What the user picked on each group line: copied by "Apply to all rows", and remembered as a rule
  const [lastGroupPatches, setLastGroupPatches] = useState<
    Record<string, GroupPatch>
  >({});

  const filteredTransactions = useMemo(
    () => transactions.filter((trx) => trx.selected),
    [transactions],
  );

  const entities: IdLabelPair[] | undefined = useMemo(
    () =>
      props.data.entities.map((entity) => ({
        id: entity.entity_id,
        label: entity.name,
      })),
    [props.data.entities],
  );
  const categories: IdLabelPair[] | undefined = useMemo(
    () =>
      props.data.categories.map((category) => ({
        id: category.category_id,
        label: category.name,
      })),
    [props.data.categories],
  );
  const accounts: IdLabelPair[] | undefined = useMemo(
    () =>
      props.data.activeAccounts.map((account) => ({
        id: account.account_id,
        label: account.name,
      })),
    [props.data.activeAccounts],
  );

  const newAccountBalance: number = useMemo(() => {
    const initialBalance = toFiniteNumber(
      props.data.activeAccounts.find(
        (acc) => acc.account_id == props.data.selectedAccountId,
      )?.balance,
    );
    return filteredTransactions.reduce((acc, row) => {
      let amount = toFiniteNumber(row.value);
      if (row.accountFrom?.id == props.data.selectedAccountId) {
        amount *= -1;
      }
      return acc + amount;
    }, initialBalance);
  }, [
    props.data.selectedAccountId,
    props.data.activeAccounts,
    filteredTransactions,
  ]);

  useEffect(() => {
    if (importTrxStep2Request.isPending) {
      loader.showLoading();
    } else {
      loader.hideLoading();
    }
  }, [importTrxStep2Request.isPending]);

  useEffect(() => {
    if (importTrxStep2Request.isError) {
      snackbar.showSnackbar(
        t('common.somethingWentWrongTryAgain'),
        AlertSeverity.ERROR,
      );
    }
  }, [importTrxStep2Request.isError]);

  useEffect(() => {
    if (importTrxStep2Request.data) {
      props.onNext({
        nrOfTrxImported: importTrxStep2Request.data.imported,
        accountName:
          accounts.find((acc) => acc.id == props.data.selectedAccountId)
            ?.label || '',
      });
    }
  }, [importTrxStep2Request.data]);

  useEffect(() => {
    if (!props.data.fillData) return;
    const trx = props.data.fillData.map((item, index) => ({
      tempId: index,
      selected: true,
      date: item.date || 0,
      description: item.description || '',
      value: toFiniteNumber(item.amount),
      entity: entities.find((entity) => entity.id == item.selectedEntityID),
      category: categories.find(
        (category) => category.id == item.selectedCategoryID,
      ),
      accountFrom: accounts.find(
        (account) => account.id == item.selectedAccountFromID,
      ),
      accountTo: accounts.find(
        (account) => account.id == item.selectedAccountToID,
      ),
      essential:
        item.isEssential == true &&
        canMarkAsEssential({
          accountFrom: accounts.find(
            (account) => account.id == item.selectedAccountFromID,
          ),
          accountTo: accounts.find(
            (account) => account.id == item.selectedAccountToID,
          ),
        }),
      externalId: item.external_id,
      type: item.type,
      payee: item.payee,
      payeeMatch: item.payee_match,
      payeeMatchExact: item.payee_match_exact,
    }));

    setTransactions(trx);
  }, [props.data.fillData]);

  type UpdateTransactionRef = {
    (id: number, updates: Partial<ImportedTrx>): void;
    timeout?: number;
  };

  const updateTransactionRef = useRef<UpdateTransactionRef>(
    (id: number, updates: Partial<ImportedTrx>) => {
      setTransactions((prevTransactions) =>
        prevTransactions.map((trx) =>
          trx.tempId === id ? { ...trx, ...updates } : trx,
        ),
      );
    },
  );

  const debouncedUpdateTransaction = useCallback(
    (id: number, updates: Partial<ImportedTrx>) => {
      if (updateTransactionRef.current.timeout) {
        clearTimeout(updateTransactionRef.current.timeout);
      }
      updateTransactionRef.current.timeout = window.setTimeout(() => {
        updateTransactionRef.current(id, updates);
      }, 700) as unknown as number;
    },
    [],
  );

  // Stable callbacks for memoized cell components
  const handleSelectedChange = useCallback((id: number, checked: boolean) => {
    updateTransactionRef.current(id, { selected: checked });
  }, []);

  const handleDateChange = useCallback((id: number, timestamp: number) => {
    updateTransactionRef.current(id, { date: timestamp });
  }, []);

  const handleValueChange = useCallback((id: number, value: number) => {
    debouncedUpdateTransaction(id, { value });
  }, [debouncedUpdateTransaction]);

  const handleDescriptionChange = useCallback((id: number, description: string) => {
    debouncedUpdateTransaction(id, { description });
  }, [debouncedUpdateTransaction]);

  const handleDescriptionBlur = useCallback((id: number, description: string) => {
    updateTransactionRef.current(id, { description });
  }, []);

  // Category/entity pickers can create missing items; refs keep the callbacks stable
  const categoryCreateRef = useRef(categoryCreate);
  categoryCreateRef.current = categoryCreate;
  const entityCreateRef = useRef(entityCreate);
  entityCreateRef.current = entityCreate;

  const categoryOptions = useMemo(
    () => categoryCreate.withCreated(categories),
    [categories, categoryCreate.created],
  );
  const entityOptions = useMemo(
    () => entityCreate.withCreated(entities),
    [entities, entityCreate.created],
  );

  const filterCategoryOptions = useCallback<CreatableOptionsFilter>(
    (options, state) => categoryCreateRef.current.filterOptions(options, state),
    [],
  );
  const filterEntityOptions = useCallback<CreatableOptionsFilter>(
    (options, state) => entityCreateRef.current.filterOptions(options, state),
    [],
  );

  const handleCategoryChange = useCallback(
    async (id: number, value: CreatableOption | null) => {
      const resolved = await categoryCreateRef.current.resolve(
        value,
        categories,
      );
      if (resolved === undefined) return;
      updateTransactionRef.current(id, { category: resolved ?? undefined });
    },
    [categories],
  );

  const handleEntityChange = useCallback(
    async (id: number, value: CreatableOption | null) => {
      const resolved = await entityCreateRef.current.resolve(value, entities);
      if (resolved === undefined) return;
      updateTransactionRef.current(id, { entity: resolved ?? undefined });
    },
    [entities],
  );

  const handleAccountFromChange = useCallback(
    (id: number, accountFrom: IdLabelPair | null) => {
      const currentTransaction = transactions.find((trx) => trx.tempId === id);
      const nextAccountFrom = accountFrom ?? undefined;
      const nextAccountTo = currentTransaction?.accountTo;
      updateTransactionRef.current(id, {
        accountFrom: nextAccountFrom,
        ...(!canMarkAsEssential({
          accountFrom: nextAccountFrom,
          accountTo: nextAccountTo,
        })
          ? { essential: false }
          : {}),
      });
    },
    [transactions],
  );

  const handleAccountToChange = useCallback(
    (id: number, accountTo: IdLabelPair | null) => {
      const currentTransaction = transactions.find((trx) => trx.tempId === id);
      const nextAccountFrom = currentTransaction?.accountFrom;
      const nextAccountTo = accountTo ?? undefined;
      updateTransactionRef.current(id, {
        accountTo: nextAccountTo,
        ...(!canMarkAsEssential({
          accountFrom: nextAccountFrom,
          accountTo: nextAccountTo,
        })
          ? { essential: false }
          : {}),
      });
    },
    [transactions],
  );

  const handleEssentialChange = useCallback((id: number, essential: boolean) => {
    const currentTransaction = transactions.find((trx) => trx.tempId === id);
    updateTransactionRef.current(id, {
      essential:
        essential && !!currentTransaction && canMarkAsEssential(currentTransaction),
    });
  }, [transactions]);

  const payeeGroups = useMemo(
    () => buildPayeeGroups(transactions),
    [transactions],
  );

  const applyGroupPatch = useCallback(
    (group: PayeeGroup, patch: GroupPatch, overwrite: boolean) => {
      setTransactions((prev) =>
        fillBlankRows(prev, group, patch, overwrite).map((trx) =>
          group.rowIds.includes(trx.tempId)
            ? { ...trx, essential: trx.essential && canMarkAsEssential(trx) }
            : trx,
        ),
      );
      setLastGroupPatches((prev) => ({
        ...prev,
        [group.key]: { ...prev[group.key], ...patch },
      }));
    },
    [],
  );

  // Picking a value fills the blank rows only; clearing the picker clears the whole group
  const handleGroupCategoryChange = useCallback(
    async (group: PayeeGroup, value: CreatableOption | null) => {
      const resolved = await categoryCreateRef.current.resolve(
        value,
        categories,
      );
      if (resolved === undefined) return;
      applyGroupPatch(
        group,
        { category: resolved ?? undefined },
        resolved == null,
      );
    },
    [categories, applyGroupPatch],
  );

  const handleGroupEntityChange = useCallback(
    async (group: PayeeGroup, value: CreatableOption | null) => {
      const resolved = await entityCreateRef.current.resolve(value, entities);
      if (resolved === undefined) return;
      applyGroupPatch(group, { entity: resolved ?? undefined }, resolved == null);
    },
    [entities, applyGroupPatch],
  );

  const handleGroupEssentialChange = useCallback(
    (group: PayeeGroup, checked: boolean) =>
      applyGroupPatch(group, { essential: checked }, !checked),
    [applyGroupPatch],
  );

  const groupRows = (group: PayeeGroup) =>
    transactions.filter((trx) => group.rowIds.includes(trx.tempId));

  const canApplyGroupToAll = (group: PayeeGroup) => {
    const patch = lastGroupPatches[group.key];
    if (!patch) return false;
    return groupRows(group).some(
      (trx) =>
        ('category' in patch && trx.category?.id !== patch.category?.id) ||
        ('entity' in patch && trx.entity?.id !== patch.entity?.id) ||
        ('essential' in patch &&
          trx.essential !== (patch.essential && canMarkAsEssential(trx))),
    );
  };

  const rows = useMemo(
    () =>
      transactions.map((item) => ({
        id: item.tempId,
        include: item.selected,
        date: item.date,
        value: item.value,
        description: item.description,
        category: {
          category: item.category,
          entity: item.entity,
        },
        accountFrom: item.accountFrom,
        flow: {
          from: item.accountFrom,
          to: item.accountTo,
        },
        essential: {
          checked: item.essential && canMarkAsEssential(item),
          disabled: !canMarkAsEssential(item),
        },
      })),
    [transactions],
  );

  const ungroupedRows = useMemo(() => {
    const grouped = new Set(payeeGroups.flatMap((group) => group.rowIds));
    return rows.filter((row) => !grouped.has(row.id));
  }, [rows, payeeGroups]);

  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: 'include',
        width: 100,
        headerName: t('transactions.import'),
        editable: false,
        sortable: false,
        renderCell: (params) => (
          <CheckboxCell
            id={params.id as number}
            checked={params.value}
            onChange={handleSelectedChange}
          />
        ),
      },
      {
        field: 'date',
        headerName: t('common.date'),
        width: 170,
        editable: false,
        sortable: false,
        renderCell: (params) => (
          <DateCell
            id={params.id as number}
            value={params.value}
            onChange={handleDateChange}
          />
        ),
      },
      {
        field: 'value',
        headerName: t('common.value'),
        width: 120,
        editable: false,
        sortable: false,
        renderCell: (params) => (
          <ValueCell
            id={params.id as number}
            value={params.value}
            onDebouncedChange={handleValueChange}
          />
        ),
      },
      {
        field: 'description',
        headerName: t('common.description'),
        editable: false,
        sortable: false,
        flex: 1,
        minWidth: 100,
        renderCell: (params) => (
          <DescriptionCell
            id={params.id as number}
            description={params.value}
            onInputChange={handleDescriptionChange}
            onBlur={handleDescriptionBlur}
          />
        ),
      },
      {
        field: 'category',
        headerName: t('transactions.category'),
        editable: false,
        sortable: false,
        width: 180,
        renderCell: (params) => (
          <CategoryCell
            id={params.id as number}
            category={params.value.category}
            entity={params.value.entity}
            categories={categoryOptions}
            entities={entityOptions}
            filterCategoryOptions={filterCategoryOptions}
            filterEntityOptions={filterEntityOptions}
            onCategoryChange={handleCategoryChange}
            onEntityChange={handleEntityChange}
          />
        ),
      },
      {
        field: 'flow',
        headerName: t('transactions.flow'),
        editable: false,
        sortable: false,
        width: 180,
        renderCell: (params) => (
          <ImportTrxStep2AccountsCell
            id={params.id as number}
            accounts={accounts}
            selectedAccountFrom={params.value.from}
            selectedAccountTo={params.value.to}
            onAccountFromChange={handleAccountFromChange}
            onAccountToChange={handleAccountToChange}
          />
        ),
      },
      {
        field: 'essential',
        headerName: t('transactions.essential'),
        editable: false,
        sortable: false,
        width: 100,
        renderCell: (params) => (
          <CheckboxCell
            id={params.id as number}
            checked={params.value.checked}
            disabled={params.value.disabled}
            onChange={handleEssentialChange}
          />
        ),
      },
    ],
    [
      t,
      categoryOptions,
      entityOptions,
      accounts,
      filterCategoryOptions,
      filterEntityOptions,
      handleSelectedChange,
      handleDateChange,
      handleValueChange,
      handleDescriptionChange,
      handleDescriptionBlur,
      handleCategoryChange,
      handleEntityChange,
      handleAccountFromChange,
      handleAccountToChange,
      handleEssentialChange,
    ],
  );

  const handleContinueButtonClick = () => {
    setConfirmationDialogOpen(true);
  };

  const importTransactions = () => {
    setConfirmationDialogOpen(false);
    importTrxStep2Request.mutate({
      list: filteredTransactions.map((trx) => ({
        category_id: trx.category?.id,
        entity_id: trx.entity?.id,
        amount: trx.value,
        date_timestamp: trx.date,
        description: trx.description,
        is_essential: trx.essential && canMarkAsEssential(trx),
        type:
          inferTrxTypeByAttributes(trx.accountFrom?.id, trx.accountTo?.id) ||
          TransactionType.Transfer,
        account_from_id: trx.accountFrom?.id,
        account_to_id: trx.accountTo?.id,
        external_id: trx.externalId,
      })),
      payeeRules: toPayeeRules(transactions, payeeGroups, lastGroupPatches),
    });
  };

  return (
    <>
      {isConfirmationDialogOpen && (
        <GenericConfirmationDialog
          isOpen={isConfirmationDialogOpen}
          onClose={() => setConfirmationDialogOpen(false)}
          onPositiveClick={() => importTransactions()}
          onNegativeClick={() => setConfirmationDialogOpen(false)}
          titleText={t('transactions.completeImportQuestion')}
          descriptionText={t('transactions.importedTransactionsCnt', {
            count: filteredTransactions.length,
          })}
          alert={
            props.data.selectedAccountId === undefined
              ? ''
              : t('transactions.newBalanceForAccountValue', {
                  account: accounts.find(
                    (acc) => props.data.selectedAccountId == acc.id,
                  )?.label,
                  value: formatNumberAsCurrency.invoke(newAccountBalance),
                })
          }
          positiveText={t('transactions.import')}
        />
      )}
      <Grid container direction="column" spacing={2}>
        <Grid>
          <Typography variant="body1" component="div" sx={{ mt: 2, mb: 2 }}>
            <Trans i18nKey="importTransactions.step2Text" />
          </Typography>
        </Grid>
        {(props.data.duplicateRows ?? 0) > 0 && (
          <Grid>
            <Typography variant="body2" component="div">
              {t('importTransactions.skippedDuplicates', {
                count: props.data.duplicateRows,
              })}
            </Typography>
          </Grid>
        )}
        {payeeGroups.length > 0 && (
          <Grid>
            <FormControlLabel
              control={
                <Switch
                  checked={groupByPayee}
                  onChange={(_event, checked) => setGroupByPayee(checked)}
                />
              }
              label={t('importTransactions.groupByPayee')}
            />
          </Grid>
        )}
        {groupByPayee && payeeGroups.length > 0 ? (
          <>
            <Grid size={12}>
              <ImportTrxStep2PayeeGroups
                groups={payeeGroups}
                transactions={transactions}
                categoryOptions={categoryOptions}
                entityOptions={entityOptions}
                filterCategoryOptions={filterCategoryOptions}
                filterEntityOptions={filterEntityOptions}
                onCategoryChange={(group, value) =>
                  void handleGroupCategoryChange(group, value)
                }
                onEntityChange={(group, value) =>
                  void handleGroupEntityChange(group, value)
                }
                onEssentialChange={handleGroupEssentialChange}
                onApplyToAll={(group) =>
                  applyGroupPatch(group, lastGroupPatches[group.key], true)
                }
                canApplyToAll={canApplyGroupToAll}
                renderRows={(group) => (
                  <MyFinStaticTable
                    isRefetching={false}
                    rows={rows.filter((row) => group.rowIds.includes(row.id))}
                    columns={columns}
                    paginationModel={{ pageSize: 50 }}
                  />
                )}
              />
            </Grid>
            {/* Rows with no group (e.g. transfers) stay editable one by one */}
            {ungroupedRows.length > 0 && (
              <Grid size={12}>
                <MyFinStaticTable
                  isRefetching={false}
                  rows={ungroupedRows}
                  columns={columns}
                  paginationModel={{ pageSize: 50 }}
                />
              </Grid>
            )}
          </>
        ) : (
          <Grid size={12}>
            <MyFinStaticTable
              isRefetching={false}
              rows={rows}
              columns={columns}
              paginationModel={{
                pageSize: 50,
              }}
            />
          </Grid>
        )}
        <Grid sx={{ display: 'flex', justifyContent: 'center' }}>
          <Button
            variant="contained"
            color="primary"
            endIcon={<KeyboardDoubleArrowRight />}
            onClick={() => handleContinueButtonClick()}
            sx={{ width: 'fit-content', mt: theme.spacing(2) }}
          >
            {t('transactions.continueImport')}
          </Button>
        </Grid>
      </Grid>
    </>
  );
};

export default memo(ImportTrxStep2);
