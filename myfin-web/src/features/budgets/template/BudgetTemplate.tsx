import {
  AddCircleOutline,
  ArrowBack,
  AutoAwesome,
  DeleteOutline,
  EditOutlined,
  SaveAlt,
} from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputBase,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NumericFormat } from 'react-number-format';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../../components/PageHeader.tsx';
import { ROUTE_BUDGETS } from '../../../providers/RoutesProvider.tsx';
import {
  AlertSeverity,
  useSnackbar,
} from '../../../providers/SnackbarProvider.tsx';
import {
  useCreateBudgetTemplate,
  useDeleteBudgetTemplate,
  useGetBudgetTemplate,
  useGetBudgetTemplateSuggestions,
  useGetBudgetTemplates,
  useGetBudgets,
  useRenameBudgetTemplate,
  useSaveBudgetTemplate,
  useSaveBudgetTemplateFromBudget,
} from '../../../services/budget/budgetHooks.ts';
import type {
  BudgetBreakdownItem,
  BudgetTemplateRow,
} from '../../../services/budget/budgetServices.ts';
import { useGetCategories } from '../../../services/category/CategoryHooks.tsx';
import { CategoryStatus } from '../../../services/category/categoryServices.ts';
import { apiErrorMessage } from '../../../utils/apiErrorMessage.ts';
import { getMonthsFullName } from '../../../utils/dateUtils.ts';
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
  expense_items: BudgetBreakdownItem[];
  income_items: BudgetBreakdownItem[];
};

const itemsKey = (direction: Direction) =>
  direction === 'debit' ? 'expense_items' : 'income_items';
const amountKey = (direction: Direction) =>
  direction === 'debit' ? 'planned_amount_debit' : 'planned_amount_credit';
const hasPlanned = (row: Row) =>
  row.planned_amount_debit !== 0 ||
  row.planned_amount_credit !== 0 ||
  row.expense_items.length > 0 ||
  row.income_items.length > 0;
const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name);

const BudgetTemplate = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const snackbar = useSnackbar();
  const format = useFormatNumberAsCurrency();
  const currencyPrefix = format.invoke(0).replace(/[\d.,\s]/g, '');

  const templatesRequest = useGetBudgetTemplates();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  // After saving a budget as a *new* template: pick it once the list has it
  const [selectByName, setSelectByName] = useState<string | null>(null);
  const templateRequest = useGetBudgetTemplate(selectedId);
  const createTemplateRequest = useCreateBudgetTemplate();
  const renameTemplateRequest = useRenameBudgetTemplate();
  const deleteTemplateRequest = useDeleteBudgetTemplate();
  const [nameDialog, setNameDialog] = useState<'create' | 'rename' | null>(
    null,
  );
  const [nameValue, setNameValue] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const categoriesRequest = useGetCategories();
  const saveRequest = useSaveBudgetTemplate();
  const fromBudgetRequest = useSaveBudgetTemplateFromBudget();

  const [rows, setRows] = useState<Record<string, Row>>({});
  const [dirty, setDirty] = useState(false);

  const [suggestOpen, setSuggestOpen] = useState(false);
  const suggestionsRequest = useGetBudgetTemplateSuggestions(
    suggestOpen,
    selectedId,
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const [fromBudgetOpen, setFromBudgetOpen] = useState(false);
  const [fromBudgetId, setFromBudgetId] = useState('');
  const budgetsRequest = useGetBudgets(0, 100, '', undefined);

  const templates = templatesRequest.data;
  useEffect(() => {
    if (!templates || templates.length === 0) return;
    const byName = selectByName
      ? templates.find((tpl) => tpl.name === selectByName)
      : undefined;
    if (byName) {
      setSelectedId(String(byName.template_id));
      setSelectByName(null);
    } else if (
      !selectedId ||
      !templates.some((tpl) => String(tpl.template_id) === selectedId)
    ) {
      setSelectedId(String(templates[0].template_id));
    }
  }, [templates, selectedId, selectByName]);

  const selectTemplate = (id: string) => {
    if (id === selectedId) return;
    if (dirty && !window.confirm(t('budgetTemplate.discardConfirm'))) return;
    setSelectedId(id);
  };

  const showError = (error: unknown) =>
    snackbar.showSnackbar(
      apiErrorMessage(error, t('common.somethingWentWrongTryAgain')),
      AlertSeverity.ERROR,
    );

  const submitName = () => {
    const name = nameValue.trim();
    if (!name) return;
    if (nameDialog === 'create') {
      createTemplateRequest.mutate(name, {
        onSuccess: (created) => {
          setNameDialog(null);
          if (dirty && !window.confirm(t('budgetTemplate.discardConfirm')))
            return;
          setSelectedId(String(created.template_id));
        },
        onError: showError,
      });
    } else if (selectedId) {
      renameTemplateRequest.mutate(
        { templateId: selectedId, name },
        { onSuccess: () => setNameDialog(null), onError: showError },
      );
    }
  };

  const confirmDelete = () => {
    if (!selectedId) return;
    deleteTemplateRequest.mutate(selectedId, {
      onSuccess: () => {
        setDeleteOpen(false);
        setSelectedId(undefined);
      },
      onError: showError,
    });
  };

  // Active categories only: inactive ones cannot be saved into a budget or template.
  const categories = useMemo(
    () =>
      (categoriesRequest.data ?? []).filter(
        (c) => c.status === CategoryStatus.Active,
      ),
    [categoriesRequest.data],
  );

  // (Re)build the grid from the saved template whenever it or the categories change.
  useEffect(() => {
    if (!templateRequest.data || !categoriesRequest.data) return;
    const saved = new Map(
      templateRequest.data.rows.map((r) => [String(r.category_id), r]),
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
        planned_amount_debit: Number(s?.planned_value_debit ?? 0),
        planned_amount_credit: Number(s?.planned_value_credit ?? 0),
        expense_items: s?.expense_items ?? [],
        income_items: s?.income_items ?? [],
      };
    }
    setRows(next);
    setDirty(false);
  }, [templateRequest.data, categoriesRequest.data, categories]);

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
    setRows((prev) => resolveBudgetConflict(prev, group, keep).rows);
    setDirty(true);
  };

  const setAmount = (id: string, direction: Direction, value: number) => {
    setRows((prev) => ({
      ...prev,
      [id]: { ...prev[id], [amountKey(direction)]: value },
    }));
    setDirty(true);
  };

  const savedRowCount = templateRequest.data?.rows.length ?? 0;

  const handleSave = () => {
    const payload: BudgetTemplateRow[] = rowList
      .filter(hasPlanned)
      .map((r) => ({
        category_id: r.category_id,
        planned_value_debit: r.planned_amount_debit,
        planned_value_credit: r.planned_amount_credit,
        expense_items: r.expense_items,
        income_items: r.income_items,
      }));
    saveRequest.mutate(
      { rows: payload, templateId: selectedId },
      {
      onSuccess: () =>
        snackbar.showSnackbar(
          t('budgetTemplate.saved'),
          AlertSeverity.SUCCESS,
        ),
      onError: (error) =>
        snackbar.showSnackbar(
          apiErrorMessage(error, t('common.somethingWentWrongTryAgain')),
          AlertSeverity.ERROR,
        ),
      },
    );
  };

  const handleFromBudget = () => {
    const name = newTemplateName.trim();
    fromBudgetRequest.mutate(
      {
        budgetId: BigInt(fromBudgetId),
        target: name ? { name } : { template_id: selectedId },
      },
      {
        onSuccess: () => {
          setFromBudgetOpen(false);
          setNewTemplateName('');
          if (name) setSelectByName(name);
          snackbar.showSnackbar(
            name
              ? t('budgetTemplate.savedAsNew', { name })
              : t('budgetTemplate.savedFromBudget'),
            AlertSeverity.SUCCESS,
          );
        },
        onError: showError,
      },
    );
  };

  // Suggestions: only rows whose category is on screen; a direction is only
  // overwritten when there is a suggested amount for it.
  const suggestions = useMemo(
    () =>
      (suggestionsRequest.data ?? []).filter((s) =>
        rows[String(s.category_id)],
      ),
    [suggestionsRequest.data, rows],
  );
  const isChanged = (s: (typeof suggestions)[number]) => {
    const row = rows[String(s.category_id)];
    return (
      (s.suggested_debit > 0 &&
        s.suggested_debit !== row.planned_amount_debit) ||
      (s.suggested_credit > 0 &&
        s.suggested_credit !== row.planned_amount_credit)
    );
  };

  // Default selection: changed rows, set when the suggestions arrive.
  useEffect(() => {
    if (!suggestOpen || !suggestionsRequest.data) return;
    setPicked(
      new Set(
        suggestions.filter(isChanged).map((s) => String(s.category_id)),
      ),
    );
  }, [suggestOpen, suggestionsRequest.data]);

  const openSuggestions = () => {
    setSuggestOpen(true);
    if (suggestionsRequest.data) void suggestionsRequest.refetch();
  };

  const applySuggestions = () => {
    setRows((prev) => {
      const next = { ...prev };
      for (const s of suggestions) {
        const id = String(s.category_id);
        if (!picked.has(id) || !next[id]) continue;
        const row = { ...next[id] };
        if (s.suggested_debit > 0) {
          row.planned_amount_debit = s.suggested_debit;
          row.expense_items = [];
        }
        if (s.suggested_credit > 0) {
          row.planned_amount_credit = s.suggested_credit;
          row.income_items = [];
        }
        next[id] = row;
      }
      return next;
    });
    setDirty(true);
    setSuggestOpen(false);
  };

  const renderInput = (
    row: Row,
    direction: Direction,
    displayValue: number,
    locked: boolean,
  ) => {
    const readOnly = locked || row[itemsKey(direction)].length > 0;
    return (
      <NumericFormat
        customInput={InputBase}
        inputProps={{
          'aria-label': `${row.name}: ${t(`budgetTemplate.${direction}`)}`,
        }}
        readOnly={readOnly}
        onValueChange={(values, source) => {
          if (readOnly || source.source !== 'event') return;
          setAmount(row.category_id, direction, values.floatValue ?? 0);
        }}
        allowNegative={false}
        decimalScale={2}
        fixedDecimalScale
        thousandSeparator
        prefix={currencyPrefix}
        value={displayValue}
        onFocus={(event) => event.target.select()}
        sx={{
          fontSize: 14,
          fontWeight: 650,
          fontVariantNumeric: 'tabular-nums',
          '& input': { p: 0.5, textAlign: 'right', cursor: readOnly ? 'default' : 'text' },
          opacity: readOnly ? 0.7 : 1,
          px: 0.5,
          borderRadius: 1,
          border: '1px solid',
          borderColor: readOnly ? 'transparent' : 'divider',
          bgcolor: readOnly ? 'transparent' : 'action.hover',
          transition: 'border-color 120ms, box-shadow 120ms',
          '&:hover': readOnly ? undefined : { borderColor: 'text.secondary' },
          '&.Mui-focused': readOnly
            ? undefined
            : {
                borderColor: 'primary.main',
                boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}`,
                bgcolor: 'action.selected',
              },
        }}
      />
    );
  };

  const gridColumns = {
    xs: 'minmax(0, 1fr) 96px 96px',
    sm: 'minmax(0, 1fr) 140px 140px',
  };

  const renderRow = (
    row: Row,
    opts: {
      indent?: boolean;
      lockHint?: string;
      display?: { debit: number; credit: number };
    } = {},
  ) => {
    const locked = !!opts.lockHint;
    const hasItems =
      row.expense_items.length > 0 || row.income_items.length > 0;
    return (
      <Box
        key={row.category_id}
        sx={{
          display: 'grid',
          gridTemplateColumns: gridColumns,
          gap: 1,
          alignItems: 'center',
          py: 0.75,
          pl: opts.indent ? { xs: 2, sm: 4 } : 0,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600 }} noWrap>
            {row.name}
          </Typography>
          {(opts.lockHint || hasItems) && (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {opts.lockHint ?? t('budgetTemplate.itemsNote')}
            </Typography>
          )}
        </Box>
        {renderInput(
          row,
          'debit',
          opts.display?.debit ?? row.planned_amount_debit,
          locked,
        )}
        {renderInput(
          row,
          'credit',
          opts.display?.credit ?? row.planned_amount_credit,
          locked,
        )}
      </Box>
    );
  };

  const renderGroup = (group: BudgetGroup<Row>) => {
    const mode = budgetMode(group);
    const children = [...group.children].sort(byName);
    const parentHas = hasPlanned(group.parent);
    return (
      <Box key={group.parent.category_id} sx={{ mt: 1.5 }}>
        <Typography
          component="h3"
          sx={{ fontSize: 15, fontWeight: 650, px: 0.5, pb: 0.5 }}
        >
          {group.parent.name}
        </Typography>
        {renderRow(group.parent, {
          lockHint:
            mode === 'split' && !parentHas
              ? t('budgetDetails.budgetedPerSubcategory')
              : undefined,
          display:
            mode === 'split'
              ? {
                  debit: rolledUp(group, 'planned_debit'),
                  credit: rolledUp(group, 'planned_credit'),
                }
              : undefined,
        })}
        {children.map((child) =>
          renderRow(child, {
            indent: true,
            lockHint:
              mode === 'lump' && !hasPlanned(child)
                ? t('budgetDetails.budgetedOnWholeCategory')
                : undefined,
          }),
        )}
      </Box>
    );
  };

  if (templateRequest.isError || categoriesRequest.isError) {
    return (
      <Alert severity="error">{t('common.somethingWentWrongTryAgain')}</Alert>
    );
  }
  if (!templateRequest.data || !categoriesRequest.data) return null;

  const sortedGroups = [...groups].sort((a, b) =>
    a.parent.name.localeCompare(b.parent.name),
  );
  const sortedUnassigned = [...unassigned].sort(byName);

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Button
        startIcon={<ArrowBack />}
        onClick={() => navigate(ROUTE_BUDGETS)}
        sx={{ mb: 1 }}
      >
        {t('budgetTemplate.backToBudgets')}
      </Button>
      <PageHeader
        title={t('budgetTemplate.title')}
        subtitle={t('budgetTemplate.strapLine')}
      />

      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ mb: 2 }}
        flexWrap="wrap"
        useFlexGap
      >
        <TextField
          select
          size="small"
          label={t('budgetTemplate.template')}
          value={selectedId ?? ''}
          onChange={(event) => selectTemplate(event.target.value)}
          sx={{ minWidth: 220 }}
        >
          {(templates ?? []).map((tpl) => (
            <MenuItem
              key={String(tpl.template_id)}
              value={String(tpl.template_id)}
            >
              {tpl.name}
            </MenuItem>
          ))}
        </TextField>
        <Button
          size="small"
          startIcon={<AddCircleOutline />}
          onClick={() => {
            setNameValue('');
            setNameDialog('create');
          }}
        >
          {t('budgetTemplate.newTemplate')}
        </Button>
        <IconButton
          size="small"
          aria-label={t('budgetTemplate.rename')}
          disabled={!selectedId}
          onClick={() => {
            setNameValue(templateRequest.data?.name ?? '');
            setNameDialog('rename');
          }}
        >
          <EditOutlined fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          aria-label={t('budgetTemplate.delete')}
          disabled={!selectedId}
          onClick={() => setDeleteOpen(true)}
        >
          <DeleteOutline fontSize="small" />
        </IconButton>
      </Stack>

      {(templates?.length ?? 0) > 1 && (
        <Box sx={{ mb: 2, overflowX: 'auto' }}>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 0.5 }}>
            {t('budgetTemplate.allTemplates')}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('budgetTemplate.template')}</TableCell>
                <TableCell align="right">
                  {t('budgetTemplate.categories')}
                </TableCell>
                <TableCell align="right">{t('budgetTemplate.debit')}</TableCell>
                <TableCell align="right">
                  {t('budgetTemplate.credit')}
                </TableCell>
                <TableCell align="right">
                  {t('budgetTemplate.updated')}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {templates?.map((tpl) => (
                <TableRow
                  key={String(tpl.template_id)}
                  hover
                  selected={String(tpl.template_id) === selectedId}
                  onClick={() => selectTemplate(String(tpl.template_id))}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell sx={{ fontWeight: 600 }}>{tpl.name}</TableCell>
                  <TableCell align="right">{tpl.row_count}</TableCell>
                  <TableCell align="right">
                    {format.invoke(tpl.total_debit)}
                  </TableCell>
                  <TableCell align="right">
                    {format.invoke(tpl.total_credit)}
                  </TableCell>
                  <TableCell align="right">
                    {dayjs.unix(tpl.updated_at).format('YYYY-MM-DD')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ mb: 2 }}
        flexWrap="wrap"
      >
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saveRequest.isPending || conflicts.length > 0 || !dirty}
        >
          {t('budgetTemplate.save')}
        </Button>
        <Button
          variant="outlined"
          startIcon={<AutoAwesome />}
          onClick={openSuggestions}
        >
          {t('budgetTemplate.suggest')}
        </Button>
        <Button
          variant="outlined"
          startIcon={<SaveAlt />}
          onClick={() => setFromBudgetOpen(true)}
        >
          {t('budgetTemplate.saveBudgetAsTemplate')}
        </Button>
      </Stack>

      {savedRowCount === 0 && !dirty && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('budgetTemplate.empty')}
        </Alert>
      )}
      <BudgetConflictAlert conflicts={conflicts} onResolve={resolveConflict} />
      {dirty && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('budgetTemplate.unsaved')}
        </Alert>
      )}

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
          {t('budgetTemplate.category')}
        </Typography>
        <Typography
          sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'right' }}
        >
          {t('budgetTemplate.debit')}
        </Typography>
        <Typography
          sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'right' }}
        >
          {t('budgetTemplate.credit')}
        </Typography>
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

      <Dialog
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>{t('budgetTemplate.suggestTitle')}</DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ mb: 1.5 }}>
            {t('budgetTemplate.suggestHelp')}
          </Typography>
          {suggestionsRequest.isError ? (
            <Alert severity="error">
              {t('common.somethingWentWrongTryAgain')}
            </Alert>
          ) : !suggestionsRequest.data || suggestionsRequest.isFetching ? (
            <Typography>{t('budgetTemplate.loadingSuggestions')}</Typography>
          ) : suggestions.length === 0 ? (
            <Typography>{t('budgetTemplate.noSuggestions')}</Typography>
          ) : (
            <Box>
              {suggestions.map((s) => {
                const id = String(s.category_id);
                const row = rows[id];
                return (
                  <Box
                    key={id}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: '40px minmax(0, 1fr)',
                        sm: '40px minmax(0, 1fr) 190px 190px',
                      },
                      alignItems: 'center',
                      columnGap: 1,
                      py: 0.5,
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Checkbox
                      checked={picked.has(id)}
                      inputProps={{ 'aria-label': row.name }}
                      onChange={(_, checked) =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(id);
                          else next.delete(id);
                          return next;
                        })
                      }
                    />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600 }} noWrap>
                        {row.name}
                      </Typography>
                      {s.level === 'parent' && (
                        <Typography
                          sx={{ fontSize: 12, color: 'text.secondary' }}
                        >
                          {t('budgetTemplate.includesSubcategories')}
                        </Typography>
                      )}
                    </Box>
                    {(['debit', 'credit'] as const).map((direction) => {
                      const suggested =
                        direction === 'debit'
                          ? s.suggested_debit
                          : s.suggested_credit;
                      const current =
                        direction === 'debit'
                          ? row.planned_amount_debit
                          : row.planned_amount_credit;
                      return (
                        <Typography
                          key={direction}
                          sx={{
                            fontSize: 13,
                            fontVariantNumeric: 'tabular-nums',
                            gridColumn: { xs: 2, sm: 'auto' },
                          }}
                        >
                          {t(`budgetTemplate.${direction}`)}:{' '}
                          {format.invoke(current)}
                          {' → '}
                          <strong>
                            {suggested > 0 ? format.invoke(suggested) : '-'}
                          </strong>
                        </Typography>
                      );
                    })}
                  </Box>
                );
              })}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSuggestOpen(false)}>
            {t('budgetTemplate.cancel')}
          </Button>
          <Button
            variant="contained"
            disabled={picked.size === 0 || suggestions.length === 0}
            onClick={applySuggestions}
          >
            {t('budgetTemplate.applySelected')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={fromBudgetOpen}
        onClose={() => setFromBudgetOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{t('budgetTemplate.saveBudgetAsTemplate')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            {t('budgetTemplate.fromBudgetHelp')}
            {dirty ? ` ${t('budgetTemplate.fromBudgetDiscards')}` : ''}
          </Typography>
          <TextField
            select
            fullWidth
            label={t('budgetTemplate.budget')}
            value={fromBudgetId}
            onChange={(event) => setFromBudgetId(event.target.value)}
          >
            {(budgetsRequest.data?.results ?? []).map((b) => (
              <MenuItem key={String(b.budget_id)} value={String(b.budget_id)}>
                {getMonthsFullName(b.month)} {b.year}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            fullWidth
            sx={{ mt: 2 }}
            label={t('budgetTemplate.newTemplateNameOptional')}
            helperText={t('budgetTemplate.newTemplateNameHelp', {
              name: templateRequest.data?.name ?? '',
            })}
            value={newTemplateName}
            onChange={(event) => setNewTemplateName(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFromBudgetOpen(false)}>
            {t('budgetTemplate.cancel')}
          </Button>
          <Button
            variant="contained"
            disabled={!fromBudgetId || fromBudgetRequest.isPending}
            onClick={handleFromBudget}
          >
            {newTemplateName.trim()
              ? t('budgetTemplate.saveAsNew')
              : t('budgetTemplate.replaceTemplate')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={nameDialog !== null}
        onClose={() => setNameDialog(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {nameDialog === 'create'
            ? t('budgetTemplate.newTemplate')
            : t('budgetTemplate.rename')}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            sx={{ mt: 1 }}
            label={t('budgetTemplate.templateName')}
            value={nameValue}
            onChange={(event) => setNameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitName();
            }}
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNameDialog(null)}>
            {t('budgetTemplate.cancel')}
          </Button>
          <Button
            variant="contained"
            disabled={!nameValue.trim()}
            onClick={submitName}
          >
            {t('budgetTemplate.ok')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <DialogTitle>{t('budgetTemplate.delete')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('budgetTemplate.deleteConfirm', {
              name: templateRequest.data?.name ?? '',
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>
            {t('budgetTemplate.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleteTemplateRequest.isPending}
            onClick={confirmDelete}
          >
            {t('budgetTemplate.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default BudgetTemplate;
