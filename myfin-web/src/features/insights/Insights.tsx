import { ChevronLeft, ChevronRight } from '@mui/icons-material';
import { useTheme } from '@mui/material';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { DatePicker } from '@mui/x-date-pickers';
import dayjs, { Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import EmptyView from '../../components/EmptyView.tsx';
import PageHeader from '../../components/PageHeader.tsx';
import { useGetMonthInsights } from '../../services/insights/insightsHooks.ts';
import {
  currentYearMonth,
  formatYearMonth,
  isYearMonth,
  parseYearMonth,
} from '../../utils/istMonth.ts';
import BiggestChanges from './BiggestChanges.tsx';
import EmergencyFundCard from './EmergencyFundCard.tsx';
import SafeToSpendCard from './SafeToSpendCard.tsx';
import ForecastCard from './ForecastCard.tsx';
import FixedFlexibleCard from './FixedFlexibleCard.tsx';
import SmallSpendsCard from './SmallSpendsCard.tsx';
import SpendingCalendar from './SpendingCalendar.tsx';
import PaymentMix from './PaymentMix.tsx';
import SummaryCards from './SummaryCards.tsx';
import TrendChart from './TrendChart.tsx';
import WhereMoneyWent from './WhereMoneyWent.tsx';

const shiftYearMonth = (ym: string, delta: number) => {
  const { year, month } = parseYearMonth(ym);
  const idx = year * 12 + (month - 1) + delta;
  return formatYearMonth(Math.floor(idx / 12), (idx % 12) + 1);
};

const Insights = () => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const monthParam = searchParams.get('month');
  const ym = isYearMonth(monthParam) ? monthParam : currentYearMonth();
  const isCurrentOrFuture = ym >= currentYearMonth();

  const { data, isLoading, isError, isFetching } = useGetMonthInsights(ym);

  const selectMonth = (next: string) => {
    setSearchParams({ month: next });
  };

  const handleDateChange = (value: Dayjs | null) => {
    if (value == null || !value.isValid()) return;
    selectMonth(formatYearMonth(value.year(), value.month() + 1));
  };

  const isEmptyMonth =
    data != null &&
    data.summary.income === 0 &&
    data.summary.spending === 0 &&
    data.trend.every((m) => m.income === 0 && m.spending === 0);

  return (
    <Paper elevation={0} sx={{ p: theme.spacing(2), m: theme.spacing(2) }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'flex-start' }}
      >
        <PageHeader
          title={t('insights.insights')}
          subtitle={t('insights.strapLine')}
        />
        <Stack direction="row" alignItems="center" gap={1} mb={2}>
          <IconButton
            aria-label={t('insights.previousMonth')}
            onClick={() => selectMonth(shiftYearMonth(ym, -1))}
          >
            <ChevronLeft />
          </IconButton>
          <DatePicker
            label={t('insights.month')}
            views={['month', 'year']}
            openTo="month"
            value={dayjs(`${ym}-01`)}
            onChange={handleDateChange}
            disableFuture
            slotProps={{ textField: { size: 'small' } }}
          />
          <IconButton
            aria-label={t('insights.nextMonth')}
            disabled={isCurrentOrFuture}
            onClick={() => selectMonth(shiftYearMonth(ym, 1))}
          >
            <ChevronRight />
          </IconButton>
        </Stack>
      </Stack>
      <Box height={4} mb={2}>
        {isFetching && <LinearProgress />}
      </Box>
      <Stack gap={2} mb={2}>
        <SafeToSpendCard />
        <ForecastCard />
        <EmergencyFundCard />
      </Stack>
      {isError && <Alert severity="error">{t('insights.loadFailed')}</Alert>}
      {isLoading && !data && (
        <Typography color="text.secondary">{t('insights.loading')}</Typography>
      )}
      {data && isEmptyMonth && (
        <Box height={240} display="flex">
          <EmptyView />
        </Box>
      )}
      {data && !isEmptyMonth && (
        <Grid container spacing={2}>
          <Grid size={12}>
            <SummaryCards ym={ym} data={data} />
            {data.one_offs.length > 0 && (
              <Typography variant="caption" color="text.secondary" mt={1} display="block">
                {t('insights.oneOffsExcluded', { count: data.one_offs.length })}
              </Typography>
            )}
          </Grid>
          <Grid size={12}>
            <FixedFlexibleCard ym={ym} data={data} />
          </Grid>
          <Grid size={12}>
            <SmallSpendsCard ym={ym} />
          </Grid>
          <Grid size={12}>
            <SpendingCalendar ym={ym} />
          </Grid>
          <Grid size={{ xs: 12, lg: 7 }}>
            <WhereMoneyWent ym={ym} data={data} />
          </Grid>
          <Grid size={{ xs: 12, lg: 5 }}>
            <Stack gap={2} height="100%">
              <BiggestChanges ym={ym} data={data} />
              <PaymentMix ym={ym} data={data} />
            </Stack>
          </Grid>
          <Grid size={12}>
            <TrendChart ym={ym} data={data} onSelectMonth={selectMonth} />
          </Grid>
        </Grid>
      )}
    </Paper>
  );
};

export default Insights;
