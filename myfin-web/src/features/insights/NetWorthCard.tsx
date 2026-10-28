import { useTheme } from '@mui/material';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { ResponsiveBar } from '@nivo/bar';
import { ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useGetNetWorth } from '../../services/insights/insightsHooks.ts';
import {
  NetWorthChange,
  NetWorthParts,
} from '../../services/insights/insightsServices.ts';
import { formatYearMonth, parseYearMonth } from '../../utils/istMonth.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { buildTransactionsLink } from './drillDown.ts';
import FigureLink from './FigureLink.tsx';
import { formatMonthLabel } from './insightsFormat.ts';

type Props = {
  ym: string;
  onSelectMonth?: (ym: string) => void;
};

type PartKey = keyof NetWorthParts;

const PART_KEYS: PartKey[] = [
  'saved',
  'investment_growth',
  'write_offs',
  'other',
];

type TrendDatum = { ym: string; label: string; change: number } & NetWorthParts;

const INVESTMENTS_LINE_ID = 'investments';
const PEOPLE_LINE_ID = 'people';

const PartRow = ({
  label,
  hint,
  amount,
}: {
  label: ReactNode;
  hint?: ReactNode;
  amount: string;
}) => (
  <Stack direction="row" justifyContent="space-between" gap={2}>
    <Box minWidth={0}>
      <Typography variant="body2">{label}</Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary" component="div">
          {hint}
        </Typography>
      )}
    </Box>
    <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
      {amount}
    </Typography>
  </Stack>
);

/** #17: why net worth moved this month, a 12-month view and each account's change. */
const NetWorthCard = ({ ym, onSelectMonth }: Props) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  const { data, isError } = useGetNetWorth(ym);

  const colors: Record<PartKey, string> = {
    saved: theme.palette.success.main,
    investment_growth: theme.palette.info.main,
    write_offs: theme.palette.error.main,
    other: theme.palette.grey[500],
  };

  const chartData: TrendDatum[] = useMemo(
    () =>
      (data?.trend ?? []).map((item) => ({
        ym: formatYearMonth(item.year, item.month),
        label: formatMonthLabel(item.year, item.month, i18n.language),
        saved: item.saved,
        investment_growth: item.investment_growth,
        write_offs: item.write_offs,
        other: item.other,
        change: item.change,
      })),
    [data?.trend, i18n.language],
  );

  if (isError && !data) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6">{t('insights.netWorth.title')}</Typography>
          <Typography color="text.secondary">
            {t('insights.netWorth.loadError')}
          </Typography>
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const signed = (value: number) =>
    `${value > 0 ? '+' : ''}${formatCurrency.invoke(value)}`;
  const { year, month } = parseYearMonth(ym);
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
    i18n.language,
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
  );
  const range = { from: data.from, to: data.to };
  const lineName = (line: NetWorthChange['accounts'][number]) =>
    line.account_id === INVESTMENTS_LINE_ID
      ? t('insights.netWorth.investmentsLine')
      : line.account_id === PEOPLE_LINE_ID
        ? t('insights.netWorth.peopleLine')
        : line.name;
  const lineLink = (line: NetWorthChange['accounts'][number]) =>
    line.account_id === INVESTMENTS_LINE_ID ||
    line.account_id === PEOPLE_LINE_ID
      ? null
      : buildTransactionsLink({ account: line.account_id, range });
  const isEmpty = data.start === 0 && data.end === 0 && data.change === 0;
  // Nothing to chart: every month of the trend is zero
  const isTrendEmpty = chartData.every(
    (d) => d.change === 0 && PART_KEYS.every((key) => d[key] === 0),
  );

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6">{t('insights.netWorth.title')}</Typography>
        <Typography variant="h5" component="div" mt={1}>
          {t('insights.netWorth.headline', {
            amount: signed(data.change),
            month: monthName,
          })}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('insights.netWorth.fromTo', {
            start: formatCurrency.invoke(data.start),
            end: formatCurrency.invoke(data.end),
          })}
        </Typography>
        {isEmpty ? (
          <Typography color="text.secondary" mt={1}>
            {t('insights.netWorth.empty')}
          </Typography>
        ) : (
          <Stack direction={{ xs: 'column', md: 'row' }} gap={3} mt={2}>
            <Stack flex={1} gap={1}>
              <Typography variant="subtitle2">
                {t('insights.netWorth.parts')}
              </Typography>
              <PartRow
                label={t('insights.netWorth.saved')}
                hint={
                  <>
                    <FigureLink
                      to={buildTransactionsLink({ type: 'I', range })}
                    >
                      {t('insights.netWorth.incomeList')}
                    </FigureLink>
                    {' · '}
                    <FigureLink
                      to={buildTransactionsLink({ type: 'E', range })}
                    >
                      {t('insights.netWorth.spendingList')}
                    </FigureLink>
                  </>
                }
                amount={signed(data.parts.saved)}
              />
              <PartRow
                label={t('insights.netWorth.investmentGrowth')}
                hint={t('insights.netWorth.investmentGrowthHint')}
                amount={signed(data.parts.investment_growth)}
              />
              <PartRow
                label={
                  <FigureLink
                    to={buildTransactionsLink({
                      adjustment: 'write_off',
                      range,
                    })}
                  >
                    {t('insights.netWorth.writeOffs')}
                  </FigureLink>
                }
                hint={t('insights.netWorth.writeOffsHint')}
                amount={signed(data.parts.write_offs)}
              />
              <PartRow
                label={t('insights.netWorth.other')}
                hint={t('insights.netWorth.otherHint')}
                amount={signed(data.parts.other)}
              />
              <Divider />
              <PartRow
                label={t('insights.netWorth.debtPaidDown')}
                hint={t('insights.netWorth.debtPaidDownHint')}
                amount={signed(data.debt_paid_down)}
              />
            </Stack>
            <Stack flex={1} gap={1}>
              <Typography variant="subtitle2">
                {t('insights.netWorth.accounts')}
              </Typography>
              {data.accounts.map((line) => (
                <PartRow
                  key={line.account_id}
                  label={
                    <FigureLink to={lineLink(line)}>
                      {lineName(line)}
                    </FigureLink>
                  }
                  hint={t('insights.netWorth.fromTo', {
                    start: formatCurrency.invoke(line.start),
                    end: formatCurrency.invoke(line.end),
                  })}
                  amount={signed(line.change)}
                />
              ))}
            </Stack>
          </Stack>
        )}
        {!isTrendEmpty && (
          <>
            <Typography variant="subtitle2" mt={2} mb={1}>
              {t('insights.netWorth.trend')}
            </Typography>
            <Box height={220}>
              <ResponsiveBar<TrendDatum>
                data={chartData}
                keys={PART_KEYS}
                indexBy="ym"
                margin={{ top: 8, right: 8, bottom: 24, left: 64 }}
                padding={0.25}
                colors={(bar) => colors[bar.id as PartKey]}
                enableLabel={false}
                axisLeft={{
                  tickSize: 0,
                  tickPadding: 4,
                  tickValues: 4,
                  format: (value) => formatCurrency.invoke(Number(value)),
                }}
                axisBottom={{
                  tickSize: 0,
                  tickPadding: 4,
                  format: (value) =>
                    chartData.find((d) => d.ym === value)?.label ??
                    String(value),
                }}
                onClick={(bar) => onSelectMonth?.(String(bar.indexValue))}
                tooltip={({ id, value, data: d }) => (
                  <Box
                    sx={{
                      p: 1,
                      bgcolor: 'background.paper',
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 1,
                    }}
                  >
                    <Typography variant="caption" component="div">
                      {d.label}
                    </Typography>
                    <Typography variant="caption" component="div">
                      {`${t(`insights.netWorth.part.${id}`)}: ${signed(value ?? 0)}`}
                    </Typography>
                    <Typography variant="caption" component="div">
                      {t('insights.netWorth.trendChange', {
                        amount: signed(d.change),
                      })}
                    </Typography>
                  </Box>
                )}
                legends={[]}
                theme={{
                  text: { fill: theme.palette.text.secondary },
                  axis: { ticks: { text: { fontSize: 10 } } },
                  grid: { line: { stroke: theme.palette.divider } },
                }}
              />
            </Box>
            <Stack direction="row" gap={2} flexWrap="wrap" mt={1}>
              {PART_KEYS.map((key) => (
                <Stack key={key} direction="row" alignItems="center" gap={0.5}>
                  <Box
                    width={10}
                    height={10}
                    borderRadius="2px"
                    bgcolor={colors[key]}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {t(`insights.netWorth.part.${key}`)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default NetWorthCard;
