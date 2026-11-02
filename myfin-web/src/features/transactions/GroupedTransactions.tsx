import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ExpandMore } from '@mui/icons-material';
import {
  useGetGroupedTransactions,
  useGetTransactions,
} from '../../services/trx/trxHooks.ts';
import {
  Transaction,
  TransactionGroup,
  TransactionGroupBy,
  TransactionListOptions,
  TransactionType,
} from '../../services/trx/trxServices.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { inferTrxType } from '../../utils/transactionUtils.ts';
import { formatMonthLabel } from '../insights/insightsFormat.ts';
import { parseYearMonth } from '../../utils/istMonth.ts';

type GroupSort = 'spend' | 'income' | 'count' | 'name';

type Props = {
  groupBy: TransactionGroupBy;
  searchQuery: string;
  options: TransactionListOptions;
  onEditTransaction: (trx: Transaction) => void;
};

/** Narrows the list to a single group, on top of the page's own filters. */
function groupFilter(
  groupBy: TransactionGroupBy,
  key: string,
): TransactionListOptions {
  switch (groupBy) {
    case 'payee':
      return { payeeKey: key };
    case 'category':
      return { categoryId: key };
    case 'account':
      return key === 'none' ? {} : { accountId: key };
    case 'month':
      return { effectiveMonth: key };
    case 'type':
      return { type: key as TransactionType };
  }
}

const PAGE_SIZE = 10;

function GroupTransactions(props: {
  searchQuery: string;
  options: TransactionListOptions;
  onEditTransaction: (trx: Transaction) => void;
}) {
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  const [page, setPage] = useState(0);
  const request = useGetTransactions(
    page,
    PAGE_SIZE,
    props.searchQuery,
    props.options,
  );
  const results = request.data?.results ?? [];

  return (
    <Box>
      <Table size="small">
        <TableBody>
          {results.map((trx) => {
            const kind = inferTrxType(trx);
            const flow = [trx.account_from_name, trx.account_to_name]
              .filter(Boolean)
              .join(' → ');
            return (
              <TableRow
                key={String(trx.transaction_id)}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => props.onEditTransaction(trx)}
              >
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {trx.date_timestamp != null &&
                    new Date(trx.date_timestamp * 1000).toLocaleDateString(
                      i18n.language,
                      {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        timeZone: 'Asia/Kolkata',
                      },
                    )}
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {trx.description || '—'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {[trx.category_name, trx.entity_name]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {flow}
                  </Typography>
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Typography
                    variant="body2"
                    color={
                      kind === TransactionType.Income
                        ? 'success.main'
                        : kind === TransactionType.Expense
                          ? 'error.main'
                          : 'text.primary'
                    }
                  >
                    {formatCurrency.invoke(trx.amount)}
                  </Typography>
                </TableCell>
              </TableRow>
            );
          })}
          {!request.isLoading && results.length === 0 && (
            <TableRow>
              <TableCell colSpan={4}>{t('transactions.groupEmpty')}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <TablePagination
        component="div"
        count={Number(request.data?.filtered_count ?? 0)}
        page={page}
        rowsPerPage={PAGE_SIZE}
        rowsPerPageOptions={[PAGE_SIZE]}
        onPageChange={(_event, next) => setPage(next)}
      />
    </Box>
  );
}

const GroupedTransactions = (props: Props) => {
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  const [sort, setSort] = useState<GroupSort>('spend');
  const [expanded, setExpanded] = useState<string | null>(null);
  const request = useGetGroupedTransactions(
    props.groupBy,
    props.searchQuery,
    props.options,
  );

  const labelOf = (group: TransactionGroup): string => {
    switch (props.groupBy) {
      case 'payee':
        return group.key === ''
          ? t('transactions.groupNoDescription')
          : group.key;
      case 'category':
        return group.key === 'none'
          ? t('transactions.filterUncategorised')
          : group.label;
      case 'month': {
        const { year, month } = parseYearMonth(group.key);
        return formatMonthLabel(year, month, i18n.language);
      }
      case 'type':
        return t(
          group.key === TransactionType.Expense
            ? 'transactions.filterDebit'
            : group.key === TransactionType.Income
              ? 'transactions.filterCredit'
              : 'transactions.filterTransfer',
        );
      default:
        return group.label || t('common.externalAccount');
    }
  };

  const groups = useMemo(() => {
    const list = [...(request.data ?? [])];
    // months read best newest first whatever the sort
    if (props.groupBy === 'month') {
      return list.sort((a, b) => b.key.localeCompare(a.key));
    }
    switch (sort) {
      case 'income':
        return list.sort((a, b) => b.income - a.income);
      case 'count':
        return list.sort((a, b) => b.count - a.count);
      case 'name':
        return list.sort((a, b) => a.label.localeCompare(b.label));
      default:
        return list.sort((a, b) => b.expense - a.expense);
    }
  }, [request.data, sort, props.groupBy]);

  return (
    <Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 1 }}
      >
        <Typography variant="body2" color="text.secondary">
          {t('transactions.groupCount', { count: groups.length })}
        </Typography>
        {props.groupBy !== 'month' && (
          <TextField
            select
            size="small"
            label={t('transactions.groupSortBy')}
            value={sort}
            onChange={(event) => setSort(event.target.value as GroupSort)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="spend">
              {t('transactions.groupSortSpend')}
            </MenuItem>
            <MenuItem value="income">
              {t('transactions.groupSortIncome')}
            </MenuItem>
            <MenuItem value="count">
              {t('transactions.groupSortCount')}
            </MenuItem>
            <MenuItem value="name">{t('transactions.groupSortName')}</MenuItem>
          </TextField>
        )}
      </Stack>
      {groups.map((group) => {
        // an empty payee can't be filtered on, so it has no list to open
        const canOpen =
          !(props.groupBy === 'payee' && group.key === '') &&
          !(props.groupBy === 'account' && group.key === 'none');
        const net = group.income - group.expense;
        return (
          <Accordion
            key={group.key}
            disableGutters
            expanded={canOpen && expanded === group.key}
            onChange={(_event, isOpen) =>
              canOpen && setExpanded(isOpen ? group.key : null)
            }
            slotProps={{ transition: { unmountOnExit: true } }}
          >
            <AccordionSummary expandIcon={canOpen ? <ExpandMore /> : null}>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                gap={2}
                flexWrap="wrap"
                sx={{ width: '100%', pr: 1 }}
              >
                <Stack direction="row" alignItems="center" gap={1}>
                  <Typography>{labelOf(group)}</Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t('transactions.groupTrxCount', {
                      count: group.count,
                    })}
                  />
                </Stack>
                <Stack direction="row" gap={2} flexWrap="wrap">
                  {group.expense > 0 && (
                    <Typography color="error.main">
                      −{formatCurrency.invoke(group.expense)}
                    </Typography>
                  )}
                  {group.income > 0 && (
                    <Typography color="success.main">
                      +{formatCurrency.invoke(group.income)}
                    </Typography>
                  )}
                  {group.transfer > 0 && (
                    <Typography color="text.secondary">
                      ⇄ {formatCurrency.invoke(group.transfer)}
                    </Typography>
                  )}
                  {group.income > 0 && group.expense > 0 && (
                    <Typography fontWeight={700}>
                      {t('transactions.groupNet')} {net < 0 ? '−' : ''}
                      {formatCurrency.invoke(Math.abs(net))}
                    </Typography>
                  )}
                </Stack>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              <GroupTransactions
                searchQuery={props.searchQuery}
                options={{
                  ...props.options,
                  ...groupFilter(props.groupBy, group.key),
                }}
                onEditTransaction={props.onEditTransaction}
              />
            </AccordionDetails>
          </Accordion>
        );
      })}
      {!request.isLoading && groups.length === 0 && (
        <Typography color="text.secondary">
          {t('transactions.groupEmpty')}
        </Typography>
      )}
    </Box>
  );
};

export default GroupedTransactions;
