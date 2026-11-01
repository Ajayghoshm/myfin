import { ArrowBack, AutoAwesome } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  InputBase,
  Paper,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NumericFormat } from 'react-number-format';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import PageHeader from '../../../components/PageHeader.tsx';
import {
  ROUTE_BUDGETS,
  ROUTE_CATEGORIES,
} from '../../../providers/RoutesProvider.tsx';
import {
  AlertSeverity,
  useSnackbar,
} from '../../../providers/SnackbarProvider.tsx';
import {
  useCreateBudgetStep1,
  useGetBudget,
  useGetBudgetListSummary,
  useGetBudgetTemplate,
  useUpdateBudget,
} from '../../../services/budget/budgetHooks.ts';
import { buildQuickPayload } from './quickEntryPayload.ts';
import type {
  BudgetBreakdownItem,
  UpdateBudgetCatValues,
} from '../../../services/budget/budgetServices.ts';
import { useGetCategories } from '../../../services/category/CategoryHooks.tsx';
import { CategoryStatus } from '../../../services/category/categoryServices.ts';
import { apiErrorMessage } from '../../../utils/apiErrorMessage.ts';
import { useFormatNumberAsCurrency } from '../../../utils/textHooks.ts';
import {
  type BudgetGroup,
  type BudgetRowLike,
  budgetConflicts,
  budgetMode,
  groupBudgetRows,
  resolveBudgetConflict,
  rolledUp,
} from '../budgetGroups.ts';
import BudgetConflictAlert from '../BudgetConflictAlert.tsx';

type Direction = 'debit' | 'credit';
type Row = {
  category_id: string;
  parent_category_id: string | null;
  name: string;
  planned_amount_debit: number;
  planned_amount_credit: number;
  current_amount_debit: number;
  current_amount_credit: number;
  expense_items: BudgetBreakdownItem[];
  income_items: BudgetBreakdownItem[];
};
type Reference = Record<string, { debit: number; credit: number }>;

const amountKey = (d: Direction) =>
  d === 'debit' ? 'planned_amount_debit' : 'planned_amount_credit';
const itemsKey = (d: Direction) =>
  d === 'debit' ? 'expense_items' : 'income_items';
const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name);

const BudgetQuickEntry = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const snackbar = useSnackbar();
  const format = useFormatNumberAsCurrency();
  const currencyPrefix = format.invoke(0).replace(/[\d.,\s]/g, '');

  const now = dayjs();
  const [monthYear, setMonthYear] = useState({
    month: now.month() + 1,
    year: now.year(),
  });
  const [direction, setDirection] = useState<Direction>('debit');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [loaded, setLoaded] = useState<Record<string, Row>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  const categoriesRequest = useGetCategories();
  const summaryRequest = useGetBudgetListSummary();
  const templateRequest = useGetBudgetTemplate();
  const createRequest = useCreateBudgetStep1();
  const updateRequest = useUpdateBudget();

  // The summary tells which budget (if any) exists for this month and the previous one.
  const findBudgetId = (month: number, year: number) =>
    (summaryRequest.data ?? []).find((b) => b.month === month && b.year === year)
      ?.budget_id;
  const previous =
    monthYear.month === 1
      ? { month: 12, year: monthYear.year - 1 }
      : { month: monthYear.month - 1, year: monthYear.year };
  const existingId = findBudgetId(monthYear.month, monthYear.year);
  const previousId = findBudgetId(previous.month, previous.year);

  const budgetRequest = useGetBudget(existingId ?? -1n);
  const previousRequest = useGetBudget(previousId ?? -1n);
  // keepPreviousData can serve another month's budget for a moment; ignore it.
  const budget =
    existingId !== undefined &&
    budgetRequest.data &&
    String(budgetRequest.data.budget_id) === String(existingId)
      ? budgetRequest.data
      : undefined;
  const previousBudget =
    previousId !== undefined &&
    previousRequest.data &&
    String(previousRequest.data.budget_id) === String(previousId)
      ? previousRequest.data
      : undefined;
  const isReady =
    !!categoriesRequest.data &&
    !!summaryRequest.data &&
    (existingId === undefined || !!budget);
  const isClosed = !!budget && !budget.is_open;

  // Active categories only: inactive ones cannot be saved into a budget.
  const categories = useMemo(
    () =>
      (categoriesRequest.data ?? []).filter(
        (c) => c.status === CategoryStatus.Active,
      ),
    [categoriesRequest.data],
  );

  useEffect(() => {
    if (!isReady) return;
    const saved = new Map(
      (budget?.categories ?? []).map((c) => [String(c.category_id), c]),
    );
    const next: Record<string, Row> = {};
    for (const c of categories) {
      const id = String(c.category_id);
      const s = saved.get(id);
      next[id] = {
        category_id: id,
        parent_category_id:
          c.parent_category_id == null ? null : String(c.parent_category_id),
        name: c.name,
        planned_amount_debit: Number(s?.planned_amount_debit ?? 0),
        planned_amount_credit: Number(s?.planned_amount_credit ?? 0),
        current_amount_debit: Number(s?.current_amount_debit ?? 0),
        current_amount_credit: Number(s?.current_amount_credit ?? 0),
        expense_items: s?.expense_items ?? [],
        income_items: s?.income_items ?? [],
      };
    }
    setRows(next);
    setLoaded(next);
    setTouched(new Set());
    setDirty(false);
  }, [isReady, budget, categories]);

  const templateRef: Reference = useMemo(() => {
    const ref: Reference = {};
    for (const r of templateRequest.data?.rows ?? []) {
      ref[String(r.category_id)] = {
        debit: Number(r.planned_value_debit),
        credit: Number(r.planned_value_credit),
      };
    }
    return ref;
  }, [templateRequest.data]);

  const lastMonthRef: Reference = useMemo(() => {
    const ref: Reference = {};
    for (const c of previousBudget?.categories ?? []) {
      ref[String(c.category_id)] = {
        debit: Number(c.planned_amount_debit ?? 0),
        credit: Number(c.planned_amount_credit ?? 0),
      };
    }
    return ref;
  }, [previousBudget]);

  const rowList = useMemo(() => Object.values(rows), [rows]);
  const { groups, unassigned } = useMemo(
    () => groupBudgetRows(rowList),
    [rowList],
  );
  const conflicts = useMemo(() => budgetConflicts(groups), [groups]);

  const resolveConflict = (
    group: BudgetGroup<BudgetRowLike>,
    keep: 'parent' | 'children',
  ) => {
    const { clearedIds } = resolveBudgetConflict(rows, group, keep);
    setRows((prev) => resolveBudgetConflict(prev, group, keep).rows);
    setTouched((prev) => new Set([...prev, ...clearedIds]));
    setDirty(true);
  };

  const setAmount = (id: string, value: number) => {
    setRows((prev) => ({
      ...prev,
      [id]: { ...prev[id], [amountKey(direction)]: value },
    }));
    setTouched((prev) => new Set(prev).add(id));
    setDirty(true);
  };

  const handleMonthChange = (date: Dayjs | null) => {
    if (!date || !date.isValid()) return;
    if (dirty && !window.confirm(t('budgetQuick.discardConfirm'))) return;
    setMonthYear({ month: date.month() + 1, year: date.year() });
  };

  const handleFillFromTemplate = () => {
    const templateRows = templateRequest.data?.rows ?? [];
    if (templateRows.length === 0) {
      snackbar.showSnackbar(
        t('budgetDetails.templateEmpty'),
        AlertSeverity.INFO,
      );
      return;
    }
    const byId = new Map(templateRows.map((r) => [String(r.category_id), r]));
    setRows((prev) => {
      setTouched(new Set(Object.keys(prev)));
      const next: Record<string, Row> = {};
      for (const [id, row] of Object.entries(prev)) {
        const tr = byId.get(id);
        next[id] = {
          ...row,
          planned_amount_debit: Number(tr?.planned_value_debit ?? 0),
          planned_amount_credit: Number(tr?.planned_value_credit ?? 0),
          expense_items: tr?.expense_items ?? [],
          income_items: tr?.income_items ?? [],
        };
      }
      return next;
    });
    setDirty(true);
    snackbar.showSnackbar(
      t('budgetDetails.filledFromTemplate'),
      AlertSeverity.SUCCESS,
    );
  };

  const handleSave = () => {
    const catValues: UpdateBudgetCatValues[] = buildQuickPayload(
      rowList,
      loaded,
      existingId !== undefined && !!budget,
    );
    const callbacks = {
      onSuccess: () => {
        setDirty(false);
        snackbar.showSnackbar(t('budgetQuick.saved'), AlertSeverity.SUCCESS);
      },
      onError: (error: unknown) =>
        snackbar.showSnackbar(
          apiErrorMessage(error, t('common.somethingWentWrongTryAgain')),
          AlertSeverity.ERROR,
        ),
    };
    if (existingId !== undefined && budget) {
      updateRequest.mutate(
        {
          budget_id: Number(existingId),
          month: monthYear.month,
          year: monthYear.year,
          observations: budget.observations ?? '',
          cat_values_arr: catValues,
        },
        callbacks,
      );
    } else {
      createRequest.mutate(
        {
          month: monthYear.month,
          year: monthYear.year,
          observations: '',
          cat_values_arr: catValues,
        },
        callbacks,
      );
    }
  };

  const money = (value: number) => (value ? format.invoke(value) : '-');

  const gridColumns = {
    xs: 'minmax(0, 1fr) 110px 90px',
    sm: 'minmax(0, 1fr) 100px 100px 140px 100px',
  };
  const refCell = { display: { xs: 'none', sm: 'block' } };
  const numberSx = {
    fontSize: 13,
    textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums',
  };

  const renderRow = (
    row: Row,
    opts: {
      indent?: boolean;
      lockHint?: string;
      display?: { planned: number; actual: number };
    } = {},
  ) => {
    const items = row[itemsKey(direction)];
    const readOnly = isClosed || !!opts.lockHint || items.length > 0;
    const planned =
      opts.display?.planned ?? Number(row[amountKey(direction)] ?? 0);
    const actual =
      opts.display?.actual ??
      (direction === 'debit'
        ? row.current_amount_debit
        : row.current_amount_credit);
    const original = loaded[row.category_id];
    if (
      hideEmpty &&
      !touched.has(row.category_id) &&
      planned === 0 &&
      actual === 0 &&
      (!original || Number(original[amountKey(direction)]) === 0)
    ) {
      return null;
    }
    return (
      <Box
        key={row.category_id}
        sx={{
          display: 'grid',
          gridTemplateColumns: gridColumns,
          gap: 1,
          alignItems: 'center',
          py: 0.5,
          pl: opts.indent ? { xs: 2, sm: 4 } : 0,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600 }} noWrap>
            {row.name}
          </Typography>
          {(opts.lockHint || items.length > 0) && (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {opts.lockHint ?? t('budgetQuick.itemsNote')}
            </Typography>
          )}
        </Box>
        <Typography sx={{ ...numberSx, ...refCell }}>
          {money(templateRef[row.category_id]?.[direction] ?? 0)}
        </Typography>
        <Typography sx={{ ...numberSx, ...refCell }}>
          {money(lastMonthRef[row.category_id]?.[direction] ?? 0)}
        </Typography>
        <NumericFormat
          customInput={InputBase}
          inputProps={{
            'aria-label': `${row.name}: ${t('budgetQuick.planned')}`,
            tabIndex: readOnly ? -1 : 0,
          }}
          readOnly={readOnly}
          onValueChange={(values, source) => {
            if (readOnly || source.source !== 'event') return;
            setAmount(row.category_id, values.floatValue ?? 0);
          }}
          allowNegative={false}
          decimalScale={2}
          fixedDecimalScale
          thousandSeparator
          prefix={currencyPrefix}
          value={planned}
          onFocus={(event) => event.target.select()}
          sx={{
            fontSize: 14,
            fontWeight: 650,
            fontVariantNumeric: 'tabular-nums',
            '& input': { p: 0.5, textAlign: 'right' },
            opacity: readOnly ? 0.7 : 1,
            borderBottom: readOnly ? 'none' : '1px solid',
            borderColor: 'divider',
          }}
        />
        <Typography sx={numberSx}>{money(actual)}</Typography>
      </Box>
    );
  };

  const renderGroup = (group: BudgetGroup<Row>) => {
    const mode = budgetMode(group);
    const children = [...group.children].sort(byName);
    const plannedField = direction === 'debit' ? 'planned_debit' : 'planned_credit';
    const currentField = direction === 'debit' ? 'current_debit' : 'current_credit';
    const parentRow = renderRow(group.parent, {
      lockHint:
        mode === 'split' ? t('budgetDetails.budgetedPerSubcategory') : undefined,
      display: {
        planned: rolledUp(group, plannedField),
        actual: rolledUp(group, currentField),
      },
    });
    const childRows = children.map((child) =>
      renderRow(child, {
        indent: true,
        lockHint:
          mode === 'lump' ? t('budgetDetails.budgetedOnWholeCategory') : undefined,
      }),
    );
    if (!parentRow && childRows.every((r) => r === null)) return null;
    return (
      <Box key={group.parent.category_id} sx={{ mt: 1.5 }}>
        <Typography
          component="h3"
          sx={{ fontSize: 15, fontWeight: 650, px: 0.5, pb: 0.5 }}
        >
          {group.parent.name}
        </Typography>
        {parentRow}
        {childRows}
      </Box>
    );
  };

  if (categoriesRequest.isError || summaryRequest.isError) {
    return (
      <Alert severity="error">{t('common.somethingWentWrongTryAgain')}</Alert>
    );
  }

  const sortedGroups = [...groups].sort((a, b) =>
    a.parent.name.localeCompare(b.parent.name),
  );
  const sortedUnassigned = [...unassigned].sort(byName);
  const columnHeader = (label: string, extra = {}) => (
    <Typography
      sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'right', ...extra }}
    >
      {label}
    </Typography>
  );

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Button
        startIcon={<ArrowBack />}
        onClick={() => navigate(ROUTE_BUDGETS)}
        sx={{ mb: 1 }}
      >
        {t('budgetQuick.backToBudgets')}
      </Button>
      <PageHeader
        title={t('budgetQuick.title')}
        subtitle={t('budgetQuick.strapLine')}
      />

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ mb: 2 }}
        alignItems={{ sm: 'center' }}
        flexWrap="wrap"
      >
        <DatePicker
          views={['year', 'month']}
          label={t('budgetQuick.month')}
          value={dayjs(new Date(monthYear.year, monthYear.month - 1, 1))}
          onChange={handleMonthChange}
          slotProps={{ textField: { size: 'small' } }}
        />
        <ToggleButtonGroup
          exclusive
          size="small"
          value={direction}
          onChange={(_, value: Direction | null) => value && setDirection(value)}
        >
          <ToggleButton value="debit">{t('budgetQuick.debit')}</ToggleButton>
          <ToggleButton value="credit">{t('budgetQuick.credit')}</ToggleButton>
        </ToggleButtonGroup>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={
            !isReady ||
            isClosed ||
            !dirty ||
            conflicts.length > 0 ||
            createRequest.isPending ||
            updateRequest.isPending
          }
        >
          {t('budgetQuick.save')}
        </Button>
        <Button
          variant="outlined"
          startIcon={<AutoAwesome />}
          disabled={!isReady || isClosed || !templateRequest.data}
          onClick={handleFillFromTemplate}
        >
          {t('budgetDetails.fillFromTemplate')}
        </Button>
        <FormControlLabel
          control={
            <Switch
              checked={hideEmpty}
              onChange={(_, checked) => setHideEmpty(checked)}
            />
          }
          label={t('budgetQuick.hideEmpty')}
        />
        <Button component={RouterLink} to={ROUTE_CATEGORIES}>
          {t('budgetQuick.editCategories')}
        </Button>
      </Stack>

      {isReady && existingId === undefined && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('budgetQuick.newMonth')}
        </Alert>
      )}
      {isClosed && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('budgetQuick.closed')}
        </Alert>
      )}
      <BudgetConflictAlert conflicts={conflicts} onResolve={resolveConflict} />
      {dirty && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('budgetQuick.unsaved')}
        </Alert>
      )}

      {!isReady ? null : (
        <>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: gridColumns,
              gap: 1,
              pb: 0.5,
              borderBottom: '2px solid',
              borderColor: 'divider',
            }}
          >
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {t('budgetQuick.category')}
            </Typography>
            {columnHeader(t('budgetQuick.template'), refCell)}
            {columnHeader(t('budgetQuick.lastMonth'), refCell)}
            {columnHeader(t('budgetQuick.planned'))}
            {columnHeader(t('budgetQuick.actual'))}
          </Box>

          {sortedGroups.map(renderGroup)}
          {sortedGroups.length > 0 && sortedUnassigned.length > 0 && (
            <Typography
              component="h3"
              sx={{ fontSize: 15, fontWeight: 650, px: 0.5, pt: 2, pb: 0.5 }}
            >
              {t('budgetDetails.unassignedCategories')}
            </Typography>
          )}
          {sortedUnassigned.map((row) => renderRow(row))}
        </>
      )}
    </Paper>
  );
};

export default BudgetQuickEntry;
