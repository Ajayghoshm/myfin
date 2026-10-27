import { useTheme } from '@mui/material';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import DataCard from '../../components/DataCard.tsx';
import { useGetMonthInsights } from '../../services/insights/insightsHooks.ts';
import { useGetFinancialProfile } from '../../services/profile/financialProfileHooks.ts';
import { PanelTitle } from '../../theme/styled.ts';
import { currentYearMonth, formatYearMonth } from '../../utils/istMonth.ts';
import SavingsRateSparkline from './SavingsRateSparkline.tsx';
import { targetPercent, twelveMonthAverage } from './savingsRate.ts';

const fmt = (pct: number) => `${Math.round(pct)}%`;

/** Dashboard headline: this month's savings rate vs target and trend. */
const SavingsRateCard = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const ym = useMemo(() => currentYearMonth(), []);
  const { data, isError } = useGetMonthInsights(ym);
  const profile = useGetFinancialProfile();

  if (isError && !data) {
    return (
      <DataCard>
        <PanelTitle>{t('savingsRate.title')}</PanelTitle>
        <Typography color="text.secondary">
          {t('savingsRate.loadError')}
        </Typography>
      </DataCard>
    );
  }
  if (!data) return null;

  const rate =
    data.summary.savings_rate == null ? null : data.summary.savings_rate * 100;
  const target = profile.data
    ? targetPercent(
        profile.data.savings_target_mode,
        profile.data.savings_target_value,
        data.summary.income,
        data.typical?.income ?? null,
      )
    : null;
  const average = twelveMonthAverage(data.trend);

  const idx = data.trend.findIndex(
    (m) => formatYearMonth(m.year, m.month) === ym,
  );
  const prev = idx > 0 ? data.trend[idx - 1] : null;
  const prevRate = prev?.savings_rate == null ? null : prev.savings_rate * 100;
  // Compare the figures as displayed (rounded), so "20%" vs target "20%" never shows ✗.
  const delta =
    rate != null && prevRate != null
      ? Math.round(rate) - Math.round(prevRate)
      : null;

  const onTarget =
    rate != null && target != null
      ? Math.round(rate) >= Math.round(target)
      : null;
  const color =
    onTarget == null
      ? undefined
      : onTarget
        ? theme.palette.success.main
        : theme.palette.error.main;

  return (
    <DataCard>
      <PanelTitle>{t('savingsRate.title')}</PanelTitle>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'center' }}
        gap={2}
      >
        <Stack
          component={RouterLink}
          to={`/insights?month=${ym}`}
          gap={0.5}
          sx={{ color: 'inherit', textDecoration: 'none' }}
        >
          <Typography variant="h5" sx={{ color }}>
            {t('savingsRate.headline', {
              rate: rate == null ? '—' : fmt(rate),
            })}
            {target != null && (
              <Typography component="span" variant="body1" sx={{ ml: 1 }}>
                {t('savingsRate.target', {
                  target: fmt(target),
                  mark: onTarget == null ? '' : onTarget ? '✓' : '✗',
                })}
              </Typography>
            )}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('savingsRate.average', {
              average: average == null ? '—' : fmt(average),
            })}
            {delta != null &&
              delta !== 0 &&
              ` · ${delta > 0 ? '▲' : '▼'} ${t('savingsRate.vsLastMonth', {
                pts: Math.abs(delta),
              })}`}
          </Typography>
        </Stack>
        <SavingsRateSparkline
          values={data.trend.map((m) =>
            m.savings_rate == null ? null : m.savings_rate * 100,
          )}
          color={color ?? theme.palette.text.secondary}
          label={t('savingsRate.sparkline')}
        />
      </Stack>
    </DataCard>
  );
};

export default SavingsRateCard;
