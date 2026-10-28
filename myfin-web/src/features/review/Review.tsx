import { HistoryOutlined, LockOutlined } from '@mui/icons-material';
import { useTheme } from '@mui/material';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { DatePicker } from '@mui/x-date-pickers';
import dayjs, { type Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import DataCard from '../../components/DataCard.tsx';
import PageHeader from '../../components/PageHeader.tsx';
import {
  AlertSeverity,
  useSnackbar,
} from '../../providers/SnackbarProvider.tsx';
import {
  useGetReview,
  useGetReviewHistory,
  useSetReviewed,
} from '../../services/insights/insightsHooks.ts';
import { PanelTitle } from '../../theme/styled.ts';
import {
  currentYearMonth,
  formatYearMonth,
  isYearMonth,
  previousYearMonth,
} from '../../utils/istMonth.ts';
import ReviewStepRow from './ReviewStepRow.tsx';

/** The six month-end steps for a month (default: the previous one), plus 12 months of history. */
const Review = () => {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const monthParam = searchParams.get('month');
  const ym = isYearMonth(monthParam)
    ? monthParam
    : previousYearMonth(currentYearMonth());

  const review = useGetReview(ym);
  const history = useGetReviewHistory();
  const setReviewed = useSetReviewed();
  const snackbar = useSnackbar();
  const data = review.data?.month === ym ? review.data : undefined;
  const monthLabel = (m: string) =>
    dayjs(`${m}-01`).toDate().toLocaleString(i18n.language, {
      month: 'short',
      year: '2-digit',
    });

  const handleDateChange = (value: Dayjs | null) => {
    if (value == null || !value.isValid()) return;
    setSearchParams({
      month: formatYearMonth(value.year(), value.month() + 1),
    });
  };

  return (
    <Paper elevation={0} sx={{ p: theme.spacing(2), m: theme.spacing(2) }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'flex-start' }}
      >
        <PageHeader title={t('review.title')} subtitle={t('review.subtitle')} />
        <Box mb={2}>
          <DatePicker
            label={t('review.month')}
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
        <Grid size={{ xs: 12, md: 7 }}>
          <DataCard>
            {data == null ? (
              <Typography color={review.isError ? 'error' : 'text.secondary'}>
                {review.isError
                  ? t('common.somethingWentWrongTryAgain')
                  : t('review.loading')}
              </Typography>
            ) : (
              <>
                <PanelTitle>
                  {t('review.cardTitle', {
                    month: monthLabel(data.month),
                    done: data.done,
                    total: data.total,
                  })}
                </PanelTitle>
                {data.frozen ? (
                  <Stack direction="row" alignItems="center" gap={0.5} mb={1}>
                    <LockOutlined fontSize="small" color="disabled" />
                    <Typography variant="caption" color="text.secondary">
                      {t('review.frozenNote')}
                    </Typography>
                  </Stack>
                ) : data.reconstructed ? (
                  <Stack direction="row" alignItems="center" gap={0.5} mb={1}>
                    <HistoryOutlined fontSize="small" color="disabled" />
                    <Typography variant="caption" color="text.secondary">
                      {t('review.reconstructedNote')}
                    </Typography>
                  </Stack>
                ) : null}
                <Stack divider={<Divider flexItem />}>
                  {data.steps.map((s) => (
                    <ReviewStepRow
                      key={s.key}
                      step={s}
                      disabled={data.frozen || setReviewed.isPending}
                      onToggleReviewed={
                        s.key === 'review'
                          ? (reviewed) =>
                              setReviewed.mutate(
                                { month: ym, reviewed },
                                {
                                  onError: () => {
                                    snackbar.showSnackbar(
                                      t('review.tickFailed'),
                                      AlertSeverity.ERROR,
                                    );
                                    void review.refetch();
                                    void history.refetch();
                                  },
                                },
                              )
                          : undefined
                      }
                    />
                  ))}
                </Stack>
              </>
            )}
          </DataCard>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <DataCard>
            <PanelTitle>{t('review.history')}</PanelTitle>
            {history.data ? (
              <Stack divider={<Divider flexItem />}>
                {[...history.data].reverse().map((h) => (
                  <ButtonBase
                    key={h.month}
                    onClick={() => setSearchParams({ month: h.month })}
                    aria-pressed={h.month === ym}
                    sx={{
                      justifyContent: 'space-between',
                      py: 0.75,
                      px: 0.5,
                      fontWeight: h.month === ym ? 600 : undefined,
                    }}
                  >
                    <Typography variant="body2" component="span">
                      {monthLabel(h.month)}
                      {h.frozen ? (
                        <LockOutlined
                          sx={{ fontSize: 12, ml: 0.5 }}
                          color="disabled"
                          aria-label={t('review.frozen')}
                        />
                      ) : h.reconstructed ? (
                        <HistoryOutlined
                          sx={{ fontSize: 12, ml: 0.5 }}
                          color="disabled"
                          aria-label={t('review.reconstructed')}
                        />
                      ) : null}
                    </Typography>
                    <Typography
                      variant="body2"
                      component="span"
                      color={h.complete ? 'success.main' : 'text.secondary'}
                    >
                      {h.complete
                        ? t('review.completed')
                        : t('review.progress', {
                            done: h.done,
                            total: h.total,
                          })}
                    </Typography>
                  </ButtonBase>
                ))}
              </Stack>
            ) : (
              <Typography color="text.secondary">
                {t('review.loading')}
              </Typography>
            )}
          </DataCard>
        </Grid>
      </Grid>
    </Paper>
  );
};

export default Review;
