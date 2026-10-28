import { LockOutlined } from '@mui/icons-material';
import { useTheme } from '@mui/material';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { DatePicker } from '@mui/x-date-pickers';
import dayjs, { type Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import DataCard from '../../components/DataCard.tsx';
import PageHeader from '../../components/PageHeader.tsx';
import {
  useGetHealth,
  useGetHealthHistory,
} from '../../services/insights/insightsHooks.ts';
import type { HealthScore } from '../../services/insights/insightsServices.ts';
import { PanelTitle } from '../../theme/styled.ts';
import {
  currentYearMonth,
  formatYearMonth,
  isYearMonth,
} from '../../utils/istMonth.ts';
import HealthCheckRow from './HealthCheckRow.tsx';

const BAR_HEIGHT = 120;

const useMonthLabel = () => {
  const { i18n } = useTranslation();
  return (ym: string) =>
    dayjs(`${ym}-01`).toDate().toLocaleString(i18n.language, {
      month: 'short',
      year: '2-digit',
    });
};

type HistoryProps = {
  history: HealthScore[];
  selected: string;
  onSelect: (ym: string) => void;
};

/** One bar per month: the share of checks passed, labelled "N/M"; frozen months are marked. */
const HistoryBars = ({ history, selected, onSelect }: HistoryProps) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const monthLabel = useMonthLabel();
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Stack direction="row" gap={1} alignItems="flex-end" minWidth={480}>
        {history.map((h) => {
          const share = h.total > 0 ? h.passed / h.total : 0;
          const label = t('health.barLabel', {
            month: monthLabel(h.month),
            passed: h.passed,
            total: h.total,
          });
          return (
            <Tooltip
              key={h.month}
              title={h.frozen ? `${label} · ${t('health.frozen')}` : label}
            >
              <ButtonBase
                onClick={() => onSelect(h.month)}
                aria-label={label}
                aria-pressed={h.month === selected}
                sx={{
                  flex: 1,
                  flexDirection: 'column',
                  gap: 0.5,
                  borderRadius: 1,
                  p: 0.5,
                  outline:
                    h.month === selected
                      ? `2px solid ${theme.palette.primary.main}`
                      : 'none',
                }}
              >
                <Typography variant="caption">
                  {h.total > 0 ? `${h.passed}/${h.total}` : '–'}
                </Typography>
                <Box
                  sx={{
                    width: '100%',
                    height: BAR_HEIGHT,
                    display: 'flex',
                    alignItems: 'flex-end',
                    bgcolor: theme.palette.action.hover,
                    borderRadius: 1,
                  }}
                >
                  <Box
                    sx={{
                      width: '100%',
                      height: `${Math.round(share * 100)}%`,
                      bgcolor:
                        share >= 0.999
                          ? theme.palette.success.main
                          : theme.palette.primary.main,
                      borderRadius: 1,
                    }}
                  />
                </Box>
                <Stack direction="row" alignItems="center" gap={0.25}>
                  <Typography variant="caption" color="text.secondary">
                    {monthLabel(h.month)}
                  </Typography>
                  {h.frozen ? (
                    <LockOutlined
                      sx={{ fontSize: 12 }}
                      color="disabled"
                      aria-label={t('health.frozen')}
                    />
                  ) : null}
                </Stack>
              </ButtonBase>
            </Tooltip>
          );
        })}
      </Stack>
    </Box>
  );
};

/** The health checklist for a month, plus the last 12 months' scores. */
const Health = () => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const monthParam = searchParams.get('month');
  const ym = isYearMonth(monthParam) ? monthParam : currentYearMonth();

  const history = useGetHealthHistory();
  // The history already holds the last 12 months: only fetch an older month on its own.
  const fromHistory = history.data?.find((h) => h.month === ym);
  const single = useGetHealth(ym, history.isSuccess && fromHistory == null);

  const selectMonth = (next: string) => setSearchParams({ month: next });

  const handleDateChange = (value: Dayjs | null) => {
    if (value == null || !value.isValid()) return;
    selectMonth(formatYearMonth(value.year(), value.month() + 1));
  };

  const data =
    fromHistory ?? (single.data?.month === ym ? single.data : undefined);
  const isError = history.isError || single.isError;
  const notSetUp = data?.checks.filter((c) => c.status === 'not_set_up') ?? [];
  const counted = data?.checks.filter((c) => c.status !== 'not_set_up') ?? [];

  return (
    <Paper elevation={0} sx={{ p: theme.spacing(2), m: theme.spacing(2) }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'flex-start' }}
      >
        <PageHeader title={t('health.title')} subtitle={t('health.subtitle')} />
        <Box mb={2}>
          <DatePicker
            label={t('health.month')}
            views={['month', 'year']}
            openTo="month"
            value={dayjs(`${ym}-01`)}
            onChange={handleDateChange}
            disableFuture
            slotProps={{ textField: { size: 'small' } }}
          />
        </Box>
      </Stack>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <DataCard>
            {data == null && !isError ? (
              <Typography color="text.secondary">
                {t('health.loading')}
              </Typography>
            ) : data == null ? (
              <Typography color="error">
                {t('common.somethingWentWrongTryAgain')}
              </Typography>
            ) : (
              <>
                <PanelTitle>
                  {data.total === 0
                    ? t('health.noneSetUp')
                    : t('health.cardTitle', {
                        passed: data.passed,
                        total: data.total,
                      })}
                </PanelTitle>
                {data.frozen ? (
                  <Stack direction="row" alignItems="center" gap={0.5} mb={1}>
                    <LockOutlined fontSize="small" color="disabled" />
                    <Typography variant="caption" color="text.secondary">
                      {t('health.frozenNote')}
                    </Typography>
                  </Stack>
                ) : null}
                <Stack divider={<Divider flexItem />}>
                  {counted.map((c) => (
                    <HealthCheckRow key={c.key} check={c} />
                  ))}
                </Stack>
                {notSetUp.length > 0 ? (
                  <>
                    <Typography
                      variant="overline"
                      color="text.secondary"
                      display="block"
                      mt={2}
                    >
                      {t('health.notSetUpHeading', { count: notSetUp.length })}
                    </Typography>
                    <Stack divider={<Divider flexItem />}>
                      {notSetUp.map((c) => (
                        <HealthCheckRow key={c.key} check={c} />
                      ))}
                    </Stack>
                  </>
                ) : null}
              </>
            )}
          </DataCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <DataCard>
            <PanelTitle>{t('health.history')}</PanelTitle>
            {history.data ? (
              <HistoryBars
                history={history.data}
                selected={ym}
                onSelect={selectMonth}
              />
            ) : history.isError ? (
              <Typography color="error">
                {t('common.somethingWentWrongTryAgain')}
              </Typography>
            ) : (
              <Typography color="text.secondary">
                {t('health.loading')}
              </Typography>
            )}
          </DataCard>
        </Grid>
      </Grid>
    </Paper>
  );
};

export default Health;
