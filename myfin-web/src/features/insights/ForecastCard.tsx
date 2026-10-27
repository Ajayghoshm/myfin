import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import DataCard from '../../components/DataCard.tsx';
import { ROUTE_BUDGET_DETAILS } from '../../providers/RoutesProvider.tsx';
import {
  AlertSeverity,
  useSnackbar,
} from '../../providers/SnackbarProvider.tsx';
import {
  useCreateBudgetFromForecast,
  useGetForecast,
  useGetForecastBudgetCompare,
} from '../../services/insights/insightsHooks.ts';
import type { ForecastBudgetMode } from '../../services/insights/insightsServices.ts';
import { PanelTitle } from '../../theme/styled.ts';
import {
  currentYearMonth,
  formatYearMonth,
  parseYearMonth,
} from '../../utils/istMonth.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';

const UPCOMING_MONTHS = 12;

const upcomingMonths = (): string[] => {
  const { year, month } = parseYearMonth(currentYearMonth());
  return Array.from({ length: UPCOMING_MONTHS }, (_, i) => {
    const idx = year * 12 + (month - 1) + i + 1;
    return formatYearMonth(Math.floor(idx / 12), (idx % 12) + 1);
  });
};

const Line = ({
  label,
  value,
  bold,
}: {
  label: ReactNode;
  value: ReactNode;
  bold?: boolean;
}) => (
  <Stack direction="row" justifyContent="space-between" gap={2}>
    <Typography variant="body2" fontWeight={bold ? 700 : undefined}>
      {label}
    </Typography>
    <Typography variant="body2" fontWeight={bold ? 700 : undefined}>
      {value}
    </Typography>
  </Stack>
);

/** Per-category forecast for an upcoming month, which can become that month's budget. */
const ForecastCard = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const snackbar = useSnackbar();
  const formatCurrency = useFormatNumberAsCurrency();
  const months = useMemo(upcomingMonths, []);
  const [month, setMonth] = useState(months[0]);
  const [compareOpen, setCompareOpen] = useState(false);

  const { data } = useGetForecast(month);
  const compare = useGetForecastBudgetCompare(month, compareOpen);
  const create = useCreateBudgetFromForecast();

  const money = (n: number) => formatCurrency.invoke(n);
  const monthLabel = (ym: string, style: 'long' | 'short' = 'long') => {
    const { year, month: m } = parseYearMonth(ym);
    return new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString(
      i18n.language,
      {
        month: style,
        year: style === 'short' ? 'numeric' : undefined,
        timeZone: 'UTC',
      },
    );
  };
  const monthName = monthLabel(month);

  const run = (mode: ForecastBudgetMode) => {
    create.mutate(
      { month, mode },
      {
        onSuccess: (res) => {
          setCompareOpen(false);
          if (res.skipped_category_ids.length > 0) {
            const names = res.skipped_category_ids.map(
              (id) =>
                compare.data?.rows.find((r) => r.category_id === id)?.name ??
                data?.categories.find((c) => c.category_id === id)?.name ??
                id,
            );
            snackbar.showSnackbar(
              t('forecast.skipped', { names: names.join(', ') }),
              AlertSeverity.WARNING,
            );
          }
          navigate(ROUTE_BUDGET_DETAILS.replace(':id', res.budget_id));
        },
        onError: () =>
          snackbar.showSnackbar(
            t('common.somethingWentWrongTryAgain'),
            AlertSeverity.ERROR,
          ),
      },
    );
  };

  const onCreate = async () => {
    const result = await compare.refetch();
    if (result.data?.budget_id) setCompareOpen(true);
    else run('create');
  };

  const expenseLines =
    data?.categories.filter((c) => c.kind !== 'income') ?? [];
  const incomeLines = data?.categories.filter((c) => c.kind === 'income') ?? [];
  const hasAny =
    expenseLines.length > 0 ||
    incomeLines.length > 0 ||
    (data?.income ?? 0) > 0;

  return (
    <DataCard>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        gap={2}
        mb={1}
      >
        <PanelTitle>{t('forecast.title')}</PanelTitle>
        <TextField
          select
          size="small"
          label={t('forecast.month')}
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        >
          {months.map((m) => (
            <MenuItem key={m} value={m}>
              {monthLabel(m, 'short')}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      {!data && (
        <Typography variant="body2" color="text.secondary">
          {t('insights.loading')}
        </Typography>
      )}
      {data && !hasAny && (
        <Typography variant="body2" color="text.secondary">
          {t('forecast.noHistory')}
        </Typography>
      )}
      {data && hasAny && (
        <Stack gap={0.5}>
          {expenseLines.map((c) => (
            <Line
              key={c.category_id ?? 'yearly'}
              label={
                <>
                  {c.name}
                  {c.yearly_costs > 0 && (
                    <Typography
                      component="span"
                      variant="caption"
                      color="text.secondary"
                    >
                      {` · ${t('forecast.includesYearly', { amount: money(c.yearly_costs) })}`}
                    </Typography>
                  )}
                  {c.seasonal_factor != null && (
                    <Typography
                      component="span"
                      variant="caption"
                      color="text.secondary"
                    >
                      {` · ${t('forecast.seasonal', { factor: c.seasonal_factor.toFixed(2) })}`}
                    </Typography>
                  )}
                </>
              }
              value={money(c.amount)}
            />
          ))}
          <Divider sx={{ my: 0.5 }} />
          <Line
            bold
            label={t('forecast.total')}
            value={`${money(data.total)} (${money(data.low)} – ${money(data.high)})`}
          />
          <Line label={t('forecast.unsorted')} value={money(data.unsorted)} />
          <Line label={t('forecast.income')} value={money(data.income)} />
          {data.uncategorised_income !== 0 && (
            <Typography variant="caption" color="text.secondary">
              {t('forecast.uncategorisedIncome', {
                amount: money(data.uncategorised_income),
              })}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            {t('forecast.rangeHelp')}
          </Typography>
          <Stack direction="row" mt={1}>
            <Button
              variant="contained"
              disabled={create.isPending || compare.isFetching}
              onClick={onCreate}
            >
              {t('forecast.createBudget', { month: monthName })}
            </Button>
          </Stack>
        </Stack>
      )}

      <Dialog
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {t('forecast.compareTitle', { month: monthName })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={1}>
            {t('forecast.compareHelp')}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('forecast.category')}</TableCell>
                <TableCell align="right">{t('forecast.current')}</TableCell>
                <TableCell align="right">{t('forecast.forecast')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {compare.data?.rows.map((r) => {
                const income = r.forecast_credit > 0;
                const current = income ? r.current_credit : r.current_debit;
                const next = income ? r.forecast_credit : r.forecast_debit;
                return (
                  <TableRow key={r.category_id}>
                    <TableCell>
                      {r.name}
                      {r.has_breakdown && (
                        <Typography
                          component="span"
                          variant="caption"
                          color="text.secondary"
                        >
                          {` · ${t('forecast.hasBreakdown')}`}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">{money(current)}</TableCell>
                    <TableCell align="right">{money(next)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompareOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={create.isPending} onClick={() => run('fill_empty')}>
            {t('forecast.fillEmpty')}
          </Button>
          <Button
            variant="contained"
            disabled={create.isPending}
            onClick={() => run('replace')}
          >
            {t('forecast.replaceAll')}
          </Button>
        </DialogActions>
      </Dialog>
    </DataCard>
  );
};

export default ForecastCard;
