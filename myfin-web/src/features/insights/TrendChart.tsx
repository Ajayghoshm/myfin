import { useTheme } from '@mui/material';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { BarCustomLayerProps, ResponsiveBar } from '@nivo/bar';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import EmptyView from '../../components/EmptyView.tsx';
import { MonthInsights } from '../../services/insights/insightsServices.ts';
import { formatYearMonth } from '../../utils/istMonth.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { formatMonthLabel, formatPercent } from './insightsFormat.ts';

type Props = {
  ym: string;
  data: MonthInsights;
  onSelectMonth: (ym: string) => void;
};

type TrendDatum = {
  ym: string;
  label: string;
  income: number;
  spending: number;
  fixed: number;
  flexible: number;
  unsorted: number;
};

type Mode = 'incomeSpending' | 'fixedFlexible';

const CHART_HEIGHT = 320;
const MARGIN = { top: 20, right: 50, bottom: 40, left: 70 };

const TrendChart = ({ ym, data, onSelectMonth }: Props) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  const [mode, setMode] = useState<Mode>('incomeSpending');
  const isSplit = mode === 'fixedFlexible';

  const chartData: TrendDatum[] = useMemo(
    () =>
      data.trend.map((item) => ({
        ym: formatYearMonth(item.year, item.month),
        label: formatMonthLabel(item.year, item.month, i18n.language),
        income: item.income,
        spending: item.spending,
        fixed: item.fixed,
        flexible: item.flexible,
        unsorted: item.unsorted,
      })),
    [data.trend, i18n.language],
  );

  // Savings rate per month (null = no income, drawn as a gap).
  const rateByYm = useMemo(
    () =>
      new Map(
        data.trend.map((item) => [
          formatYearMonth(item.year, item.month),
          item.savings_rate,
        ]),
      ),
    [data.trend],
  );
  const rateOf = (key: string) => rateByYm.get(key) ?? null;

  const isEmpty = chartData.every(
    (d) => d.income === 0 && d.spending === 0,
  );

  // Secondary axis domain for the savings rate, always including 0.
  const rateDomain = useMemo(() => {
    const rates = [...rateByYm.values()].filter((r): r is number => r !== null);
    let lo = Math.min(0, ...rates);
    let hi = Math.max(0, ...rates);
    if (hi - lo < 0.1) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 1);
    }
    return { lo, hi };
  }, [rateByYm]);

  const incomeColor = theme.palette.success.main;
  const spendingColor = theme.palette.error.main;
  const rateColor = theme.palette.primary.main;
  const fixedColor = theme.palette.info.main;
  const flexibleColor = theme.palette.warning.main;
  const unsortedColor = theme.palette.grey[500];

  const SavingsRateLayer = ({
    bars,
    innerHeight,
    innerWidth,
  }: BarCustomLayerProps<TrendDatum>) => {
    const yFor = (rate: number) =>
      innerHeight -
      ((rate - rateDomain.lo) / (rateDomain.hi - rateDomain.lo)) * innerHeight;

    // Centre of each month's bar group.
    const centres = new Map<string, { min: number; max: number }>();
    for (const bar of bars) {
      const key = String(bar.data.indexValue);
      const current = centres.get(key);
      centres.set(key, {
        min: Math.min(current?.min ?? bar.x, bar.x),
        max: Math.max(current?.max ?? bar.x + bar.width, bar.x + bar.width),
      });
    }

    const points = chartData.map((d) => {
      const c = centres.get(d.ym);
      const rate = rateOf(d.ym);
      return c && rate !== null
        ? { x: (c.min + c.max) / 2, y: yFor(rate) }
        : null;
    });

    // Split into segments at gaps (months without income).
    const segments: Array<Array<{ x: number; y: number }>> = [];
    let current: Array<{ x: number; y: number }> = [];
    for (const p of points) {
      if (p === null) {
        if (current.length) segments.push(current);
        current = [];
      } else {
        current.push(p);
      }
    }
    if (current.length) segments.push(current);

    const ticks = [rateDomain.lo, 0, rateDomain.hi].filter(
      (v, i, arr) => arr.indexOf(v) === i,
    );

    return (
      <g>
        {segments.map((seg) => (
          <path
            key={`${seg[0].x}`}
            d={seg.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={rateColor}
            strokeWidth={2}
          />
        ))}
        {points.map(
          (p) =>
            p && (
              <circle
                key={`pt-${p.x}`}
                cx={p.x}
                cy={p.y}
                r={3.5}
                fill={theme.palette.background.paper}
                stroke={rateColor}
                strokeWidth={2}
              />
            ),
        )}
        <g transform={`translate(${innerWidth}, 0)`}>
          <line x1={0} x2={0} y1={0} y2={innerHeight} stroke={theme.palette.divider} />
          {ticks.map((tick) => (
            <g key={tick} transform={`translate(0, ${yFor(tick)})`}>
              <line x1={0} x2={5} stroke={theme.palette.divider} />
              <text
                x={8}
                dy="0.32em"
                style={{ fontSize: 11, fill: theme.palette.text.secondary }}
              >
                {formatPercent(tick)}
              </text>
            </g>
          ))}
        </g>
      </g>
    );
  };

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1}>
          <Typography variant="h6">{t('insights.trend')}</Typography>
          <Stack direction="row" gap={2} alignItems="center" flexWrap="wrap">
            <ToggleButtonGroup
              size="small"
              exclusive
              value={mode}
              aria-label={t('insights.trendView')}
              onChange={(_, next: Mode | null) => next && setMode(next)}
            >
              <ToggleButton value="incomeSpending">
                {t('insights.trendIncomeVsSpending')}
              </ToggleButton>
              <ToggleButton value="fixedFlexible">
                {t('insights.trendFixedVsFlexible')}
              </ToggleButton>
            </ToggleButtonGroup>
            {isSplit ? (
              <>
                <LegendItem color={fixedColor} label={t('insights.fixedLabel')} />
                <LegendItem
                  color={flexibleColor}
                  label={t('insights.flexibleLabel')}
                />
                <LegendItem
                  color={unsortedColor}
                  label={t('insights.unsortedLabel')}
                />
              </>
            ) : (
              <>
                <LegendItem color={incomeColor} label={t('insights.income')} />
                <LegendItem
                  color={spendingColor}
                  label={t('insights.spending')}
                />
                <LegendItem
                  color={rateColor}
                  label={t('insights.savingsRate')}
                  line
                />
              </>
            )}
          </Stack>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {t('insights.trendHint')}
        </Typography>
        {isEmpty ? (
          <Box height={CHART_HEIGHT} display="flex">
            <EmptyView />
          </Box>
        ) : (
          <Box height={CHART_HEIGHT}>
            <ResponsiveBar<TrendDatum>
              data={chartData}
              keys={
                isSplit
                  ? ['fixed', 'flexible', 'unsorted']
                  : ['income', 'spending']
              }
              indexBy="ym"
              groupMode={isSplit ? 'stacked' : 'grouped'}
              margin={MARGIN}
              padding={0.25}
              innerPadding={2}
              colors={(bar) => {
                const base =
                  bar.id === 'income'
                    ? incomeColor
                    : bar.id === 'fixed'
                      ? fixedColor
                      : bar.id === 'flexible'
                        ? flexibleColor
                        : bar.id === 'unsorted'
                          ? unsortedColor
                          : spendingColor;
                return bar.indexValue === ym ? base : `${base}99`;
              }}
              enableLabel={false}
              enableGridY={true}
              axisBottom={{
                tickSize: 0,
                tickPadding: 8,
                format: (value) =>
                  chartData.find((d) => d.ym === value)?.label ?? String(value),
              }}
              axisLeft={{
                tickSize: 0,
                tickPadding: 6,
                format: (value) => formatCurrency.invoke(Number(value)),
              }}
              valueFormat={(value) => formatCurrency.invoke(value)}
              onClick={(bar) => onSelectMonth(String(bar.indexValue))}
              onMouseEnter={(_, event) => {
                event.currentTarget.style.cursor = 'pointer';
              }}
              tooltip={(bar) => (
                <Paper
                  sx={{
                    fontSize: '12px',
                    p: theme.spacing(1),
                    whiteSpace: 'nowrap',
                  }}
                >
                  <strong>{bar.data.label}</strong>
                  <br />
                  {isSplit ? (
                    <>
                      {t('insights.fixedLabel')}:{' '}
                      {formatCurrency.invoke(bar.data.fixed)}
                      <br />
                      {t('insights.flexibleLabel')}:{' '}
                      {formatCurrency.invoke(bar.data.flexible)}
                      <br />
                      {t('insights.unsortedLabel')}:{' '}
                      {formatCurrency.invoke(bar.data.unsorted)}
                    </>
                  ) : (
                    <>
                      {t('insights.income')}:{' '}
                      {formatCurrency.invoke(bar.data.income)}
                      <br />
                      {t('insights.spending')}:{' '}
                      {formatCurrency.invoke(bar.data.spending)}
                      <br />
                      {t('insights.savingsRate')}:{' '}
                      {(() => {
                        const rate = rateOf(bar.data.ym);
                        return rate === null ? '—' : formatPercent(rate);
                      })()}
                    </>
                  )}
                </Paper>
              )}
              layers={
                isSplit
                  ? ['grid', 'axes', 'bars', 'markers']
                  : ['grid', 'axes', 'bars', SavingsRateLayer, 'markers']
              }
              theme={theme.nivo}
            />
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

const LegendItem = ({
  color,
  label,
  line,
}: {
  color: string;
  label: string;
  line?: boolean;
}) => (
  <Stack direction="row" gap={0.5} alignItems="center">
    <Box
      sx={{
        width: 12,
        height: line ? 3 : 12,
        borderRadius: line ? 0 : 0.5,
        background: color,
      }}
    />
    <Typography variant="caption">{label}</Typography>
  </Stack>
);

export default TrendChart;
