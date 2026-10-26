import {
  ListItem,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  useTheme,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import InputAdornment from '@mui/material/InputAdornment';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  GridColDef,
  GridRowSelectionModel,
  GridSortModel,
} from '@mui/x-data-grid';
import Alert from '@mui/material/Alert';
import BulkEditTransactionsDialog from './BulkEditTransactionsDialog.tsx';
import PageHeader from '../../components/PageHeader.tsx';
import { useLoading } from '../../providers/LoadingProvider.tsx';
import {
  useBulkUpdateTransactions,
  useGetTransactions,
  useRemoveTransaction,
} from '../../services/trx/trxHooks.ts';
import {
  Tag,
  Transaction,
  TransactionListOptions,
  TransactionType,
} from '../../services/trx/trxServices.ts';
import React, { memo, useEffect, useMemo, useState } from 'react';
import {
  AddCircleOutline,
  ArrowBack,
  ArrowForward,
  Business,
  ContentCopy,
  Delete,
  Edit,
  FolderShared,
  Search,
  Stars,
} from '@mui/icons-material';
import { formatNumberAsCurrency } from '../../utils/textUtils.ts';
import { useTranslation } from 'react-i18next';
import {
  convertUnixTimestampToDateString,
  getDayNumberFromUnixTimestamp,
  getMonthShortStringFromUnixTimestamp,
  getShortYearFromUnixTimestamp,
} from '../../utils/dateUtils.ts';
import MyFinTable from '../../components/MyFinTable.tsx';
import { AlertSeverity, useSnackbar } from '../../providers/SnackbarProvider.tsx';
import Button from '@mui/material/Button';
import GenericConfirmationDialog from '../../components/GenericConfirmationDialog.tsx';
import AddEditTransactionDialog from './AddEditTransactionDialog.tsx';
import IconButton from '@mui/material/IconButton';
import { inferTrxType } from '../../utils/transactionUtils.ts';
import { useNavigate } from 'react-router-dom';
import { debounce } from 'lodash';
import { ROUTE_IMPORT_TRX } from '../../providers/RoutesProvider.tsx';

const Transactions = () => {
  const theme = useTheme();
  const loader = useLoading();
  const snackbar = useSnackbar();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [paginationModel, setPaginationModel] = useState({
    pageSize: 20,
    page: 0,
  });
  const [actionableTransaction, setActionableTransaction] =
    useState<Transaction | null>(null);
  const [isRemoveDialogOpen, setRemoveDialogOpen] = useState(false);
  const [isAddEditDialogOpen, setEditDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortModel, setSortModel] = useState<GridSortModel>([]);
  const [typeFilter, setTypeFilter] = useState<TransactionType | null>(null);
  const listOptions: TransactionListOptions = useMemo(() => {
    const sort = sortModel[0];
    return {
      sortBy: sort
        ? sort.field === 'value'
          ? 'amount'
          : sort.field === 'flow'
            ? 'type'
            : undefined
        : undefined,
      sortDir: sort?.sort ?? undefined,
      type: typeFilter ?? undefined,
    };
  }, [sortModel, typeFilter]);
  const getTransactionsRequest = useGetTransactions(
    paginationModel.page,
    paginationModel.pageSize,
    searchQuery,
    listOptions,
  );

  // a new sort or filter starts from the first page
  useEffect(() => {
    setPaginationModel((model) => ({ ...model, page: 0 }));
  }, [sortModel, typeFilter]);

  const emptySelection: GridRowSelectionModel = { type: 'include', ids: new Set() };
  const [rowSelection, setRowSelection] =
    useState<GridRowSelectionModel>(emptySelection);
  // true when "select all matching" covers every page of the current search/filter
  const [allMatchingSelected, setAllMatchingSelected] = useState(false);
  const [isBulkEditOpen, setBulkEditOpen] = useState(false);
  const bulkUpdateRequest = useBulkUpdateTransactions();

  const clearSelection = () => {
    setRowSelection(emptySelection);
    setAllMatchingSelected(false);
  };

  // a selection only ever refers to what is currently listed
  useEffect(() => {
    clearSelection();
  }, [
    paginationModel.page,
    paginationModel.pageSize,
    searchQuery,
    sortModel,
    typeFilter,
  ]);
  const removeTransactionRequest = useRemoveTransaction();
  const debouncedSearchQuery = useMemo(() => debounce(setSearchQuery, 300), []);

  // Show loading indicator when isLoading is true
  useEffect(() => {
    if (getTransactionsRequest.isLoading) {
      loader.showLoading();
    } else {
      loader.hideLoading();
    }
  }, [getTransactionsRequest.isLoading]);

  // Show error when isError is true
  useEffect(() => {
    if (getTransactionsRequest.isError || removeTransactionRequest.isError) {
      snackbar.showSnackbar(
        t('common.somethingWentWrongTryAgain'),
        AlertSeverity.ERROR,
      );
    }
  }, [getTransactionsRequest.isError, removeTransactionRequest.isError]);

  useEffect(() => {
    if (isRemoveDialogOpen == false && isAddEditDialogOpen == false) {
      setActionableTransaction(null);
    }
  }, [isAddEditDialogOpen, isRemoveDialogOpen]);

  const removeTransaction = () => {
    if (!actionableTransaction) return;
    removeTransactionRequest.mutate(actionableTransaction?.transaction_id);
    setRemoveDialogOpen(false);
  };

  const handleEditTransactionClick = (trx: Transaction) => {
    setActionableTransaction(trx);
    setEditDialogOpen(true);
  };

  const handleRemoveTransactionClick = (trx: Transaction) => {
    setActionableTransaction(trx);
    setRemoveDialogOpen(true);
  };

  const handleImportTransactionsClick = () => {
    navigate(ROUTE_IMPORT_TRX);
  };

  const handleAddTransactionClick = () => {
    /*setAddTrxDialogOpen(true);*/
    setEditDialogOpen(true);
  };

  const columns: GridColDef[] = [
    {
      field: 'date',
      headerName: t('common.date'),
      flex: 100,
      minWidth: 100,
      editable: false,
      sortable: false,
      renderCell: (params) => {
        const textColor =
          (params.value.first == true) ? theme.palette.text.primary : theme.palette.text.disabled;
        return (
          <Stack direction="column" alignItems="center" gap={0.5}>
            <Box
              display="flex"
              flexDirection="column"
              alignItems="center"
              justifyContent="center"
              height="100%"
            >

            <span style={{ textAlign: 'center', color: textColor }}>
              <b>
                {getDayNumberFromUnixTimestamp(params.value.date_timestamp)}
              </b>{' '}
              {/*<br />*/}
              <span>
                {getMonthShortStringFromUnixTimestamp(
                  params.value.date_timestamp,
                )}
                {' \''}
                {getShortYearFromUnixTimestamp(params.value.date_timestamp)}
              </span>
            </span>
            </Box>
            <Tooltip title={t('transactions.essential')}>
              <IconButton
                sx={{
                  display: params.value.essential === 1 ? 'flex' : 'none',
                }}
              >
                <Stars fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        );
      },
    },
    {
      field: 'flow',
      headerName: t('transactions.flow'),
      flex: 200,
      minWidth: 200,
      editable: false,
      sortable: true,
      sortingOrder: ['desc', 'asc', null],
      renderCell: (params) => (
        <Stack>
          <Stack direction="row" alignItems="center" gap={0.5}>
            <ArrowBack
              fontSize="small"
              color={params.value.acc_from_name ? 'primary' : 'secondary'}
            />{' '}
            {params.value.acc_from_name ?? t('common.externalAccount')}
          </Stack>
          <Stack direction="row" alignItems="center" gap={0.5}>
            <ArrowForward
              fontSize="small"
              color={params.value.acc_to_name ? 'secondary' : 'primary'}
            />{' '}
            {params.value.acc_to_name ?? t('common.externalAccount')}
          </Stack>
        </Stack>
      ),
    },
    {
      field: 'description',
      headerName: t('common.description'),
      flex: 700,
      minWidth: 400,
      editable: false,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="column" gap={1} p={2}>
          <Stack direction="row" alignItems="center" gap={0}>
            {params.value.description ?? t('common.externalAccount')}
          </Stack>
          <Stack direction="row" alignItems="center" gap={0.5}>
            <FolderShared fontSize="small" color="primary" />{' '}
            {params.value.category ?? t('common.noCategory')}
            {'     '}
            <Business fontSize="small" color="primary" />{' '}
            {params.value.entity ?? t('common.noEntity')}
          </Stack>
          <Stack direction="row" alignItems="center" gap={0.5}>
            {params.value.tags.length > 0 && (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'row', // Set flexDirection to 'row' to align chips side by side
                  justifyContent: 'flex-start', // Adjust alignment as needed
                  flexWrap: 'wrap', // Allow wrapping of chips
                  listStyle: 'none',
                  p: 0.5,
                  m: 0,
                }}
                component="ul"
              >
                {params.value.tags.map((data: Tag) => {
                  return (
                    <ListItem key={data.tag_id} sx={{ width: 'auto', p: 0.5 }}>
                      <Chip
                        label={data.name}
                        variant="outlined"
                        size="small"
                        color="primary"
                        onClick={() => {
                        }}
                      />
                    </ListItem>
                  );
                })}
              </Box>
            )}
          </Stack>
        </Stack>
      ),
    },
    {
      field: 'value',
      headerName: t('common.value'),
      flex: 170,
      minWidth: 100,
      editable: false,
      sortable: true,
      sortingOrder: ['desc', 'asc', null],
      renderCell: (params) => (
        <Chip
          color={params.value.chipColor}
          variant="outlined"
          label={
            <Typography variant="subtitle2">
              <strong>{params.value.amount}</strong>
            </Typography>
          }
        />
      ),
    },
    {
      field: 'actions',
      headerName: t('common.actions'),
      flex: 150,
      minWidth: 100,
      editable: false,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" gap={0}>
          <IconButton
            aria-label={t('common.edit')}
            onClick={() => {
              handleEditTransactionClick(params.value);
            }}
          >
            <Edit fontSize="medium" color="action" />
          </IconButton>
          <IconButton
            aria-label={t('common.delete')}
            onClick={(event) => {
              event.stopPropagation();
              handleRemoveTransactionClick(params.value);
            }}
          >
            <Delete fontSize="medium" color="action" />
          </IconButton>
        </Stack>
      ),
    },
  ];
  if (getTransactionsRequest.isLoading || !getTransactionsRequest.data) {
    return null;
  }

  const pageIds = getTransactionsRequest.data.results.map(
    (trx) => trx.transaction_id,
  );
  // row ids are bigints, the grid types them as GridRowId, so compare as strings
  const selectedIdKeys = new Set([...rowSelection.ids].map(String));
  const selectedIdsOnPage = pageIds.filter(
    (id) => selectedIdKeys.has(String(id)) === (rowSelection.type === 'include'),
  );
  const matchingCount = Number(getTransactionsRequest.data.filtered_count);
  const selectedCount = allMatchingSelected
    ? matchingCount
    : selectedIdsOnPage.length;
  const isWholePageSelected =
    pageIds.length > 0 && selectedIdsOnPage.length === pageIds.length;

  const applyBulkEdit = (
    changes: Parameters<typeof bulkUpdateRequest.mutate>[0],
  ) => {
    bulkUpdateRequest.mutate(
      {
        ...changes,
        ...(allMatchingSelected
          ? { filter: { query: searchQuery, type: typeFilter ?? undefined } }
          : { transaction_ids: selectedIdsOnPage }),
      },
      {
        onSuccess: (result) => {
          snackbar.showSnackbar(
            t('transactions.bulkEditSuccess', { count: result.updated }),
            AlertSeverity.SUCCESS,
          );
          setBulkEditOpen(false);
          clearSelection();
        },
        onError: () => {
          snackbar.showSnackbar(
            t('common.somethingWentWrongTryAgain'),
            AlertSeverity.ERROR,
          );
        },
      },
    );
  };

  function getChipColorForAmount(trx: Transaction): string {
    switch (inferTrxType(trx)) {
      case TransactionType.Expense:
        return 'primary';
      case TransactionType.Income:
        return 'secondary';
      case TransactionType.Transfer:
      default:
        return 'default';
    }
  }

  const rows = (() => {
    const seenDates = new Set();

    return getTransactionsRequest.data.results.map(
      (result: Transaction) => {
        const dateKey = convertUnixTimestampToDateString(result.date_timestamp || 0);
        const isFirstOfDay = !seenDates.has(dateKey);
        if (isFirstOfDay) {
          seenDates.add(dateKey);
        }

        return {
          id: result.transaction_id,
          date: {
            date_timestamp: result.date_timestamp,
            essential: result.is_essential,
            first: isFirstOfDay,
          },
          flow: {
            acc_from_name: result.account_from_name,
            acc_to_name: result.account_to_name,
          },
          description: {
            description: result.description,
            entity: result.entity_name,
            category: result.category_name,
            tags: result.tags,
          },
          value: {
            amount: formatNumberAsCurrency(result.amount),
            chipColor: getChipColorForAmount(result),
          },
          actions: result,
        };
      },
    );
  })();

  return (
    <Paper elevation={0} sx={{ p: theme.spacing(2), m: theme.spacing(2) }}>
      {isAddEditDialogOpen && (
        <AddEditTransactionDialog
          isOpen={isAddEditDialogOpen}
          onClose={() => setEditDialogOpen(false)}
          onPositiveClick={() => setEditDialogOpen(false)}
          onNegativeClick={() => setEditDialogOpen(false)}
          transaction={actionableTransaction}
        />
      )}
      {isRemoveDialogOpen && (
        <GenericConfirmationDialog
          isOpen={isRemoveDialogOpen}
          onClose={() => setRemoveDialogOpen(false)}
          onPositiveClick={() => removeTransaction()}
          onNegativeClick={() => setRemoveDialogOpen(false)}
          titleText={t('transactions.deleteTransactionModalTitle', {
            id: actionableTransaction?.transaction_id,
          })}
          descriptionText={t('transactions.deleteTransactionModalSubtitle')}
          positiveText={t('common.delete')}
        />
      )}
      <Box display="flex" justifyContent="space-between" flexDirection="column">
        <PageHeader
          title={t('transactions.transactions')}
          subtitle={t('transactions.strapLine')}
        />
      </Box>
      <Grid container spacing={2}>
        <Grid
          container
          spacing={2}
          size={{
            sm: 8,
            xs: 12,
          }}
        >
          <Grid>
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddCircleOutline />}
              onClick={() => {
                handleAddTransactionClick();
              }}
            >
              {t('transactions.addTransactionCTA')}
            </Button>
          </Grid>
          <Grid>
            <Button
              variant="outlined"
              color="primary"
              startIcon={<ContentCopy />}
              onClick={() => {
                handleImportTransactionsClick();
              }}
            >
              {t('transactions.importTransactionCTA')}
            </Button>
          </Grid>
        </Grid>
        <Grid
          sx={{ display: 'flex', justifyContent: 'flex-end' }}
          size={{
            sm: 12,
            lg: 4,
          }}
          offset="auto"
        >
          {' '}
          <TextField
            id="search"
            label={t('common.search')}
            variant="outlined"
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <Search />
                </InputAdornment>
              ),
            }}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              debouncedSearchQuery(event.target.value);
            }}
          />
        </Grid>
        <Grid size={12}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={typeFilter ?? 'all'}
            onChange={(_event, value: TransactionType | 'all' | null) => {
              if (value === null) return;
              setTypeFilter(value === 'all' ? null : value);
            }}
          >
            <ToggleButton value="all">{t('transactions.filterAll')}</ToggleButton>
            <ToggleButton value={TransactionType.Expense}>
              {t('transactions.filterDebit')}
            </ToggleButton>
            <ToggleButton value={TransactionType.Income}>
              {t('transactions.filterCredit')}
            </ToggleButton>
            <ToggleButton value={TransactionType.Transfer}>
              {t('transactions.filterTransfer')}
            </ToggleButton>
          </ToggleButtonGroup>
        </Grid>
        {selectedCount > 0 && (
          <Grid size={12}>
            <Alert
              severity="info"
              action={
                <Stack direction="row" gap={1}>
                  {isWholePageSelected &&
                    !allMatchingSelected &&
                    matchingCount > pageIds.length && (
                      <Button
                        size="small"
                        onClick={() => setAllMatchingSelected(true)}
                      >
                        {t('transactions.selectAllMatching', {
                          count: matchingCount,
                        })}
                      </Button>
                    )}
                  <Button size="small" onClick={clearSelection}>
                    {t('transactions.clearSelection')}
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => setBulkEditOpen(true)}
                  >
                    {t('transactions.editSelected', { count: selectedCount })}
                  </Button>
                </Stack>
              }
            >
              {allMatchingSelected
                ? t('transactions.allMatchingSelected', {
                    count: matchingCount,
                  })
                : t('transactions.selectedCount', { count: selectedCount })}
            </Alert>
          </Grid>
        )}
        {isBulkEditOpen && (
          <BulkEditTransactionsDialog
            isOpen={isBulkEditOpen}
            selectedCount={selectedCount}
            onClose={() => setBulkEditOpen(false)}
            onApply={applyBulkEdit}
          />
        )}
        <Grid size={12}>
          <MyFinTable
            isRefetching={getTransactionsRequest.isRefetching}
            sortModel={sortModel}
            onSortModelChange={setSortModel}
            rowSelectionModel={rowSelection}
            onRowSelectionModelChange={(model) => {
              setRowSelection(model);
              setAllMatchingSelected(false);
            }}
            rows={rows}
            columns={columns}
            itemCount={getTransactionsRequest.data.filtered_count}
            paginationModel={paginationModel}
            setPaginationModel={setPaginationModel}
            onRowClicked={(id) => {
              const trx = getTransactionsRequest.data.results.find(
                (trx) => trx.transaction_id == id,
              );
              if (trx) {
                handleEditTransactionClick(trx);
              }
            }}
          />
        </Grid>
      </Grid>
    </Paper>
  );
};

export default memo(Transactions);
