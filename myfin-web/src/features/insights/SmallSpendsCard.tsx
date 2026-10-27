import { useTheme } from '@mui/material';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { ResponsiveBar } from '@nivo/bar';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useGetSmallSpends } from '../../services/insights/insightsHooks.ts';
import { formatYearMonth } from '../../utils/istMonth.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { buildTransactionsLink } from './drillDown.ts';
import FigureLink from './FigureLink.tsx';
import { formatMonthLabel } from './insightsFormat.ts';

type Props = {
  ym: string;
};

type TrendDatum = { ym: string; label: string; total: number; count: number };

/** Small-spend leakage for the selected month: headline, top places, 12-month trend. */
const SmallSpendsCard = ({ ym }: Props) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const formatCurrency = useFormatNumberAsCurrency();
  const { data } = useGetSmallSpends(ym);

  const chartData: TrendDatum[] = useMemo(
    () =>
      (data?.trend ?? []).map((item) => ({
        ym: formatYearMonth(item.year, item.month),
        label: formatMonthLabel(item.year, item.month, i18n.language),
        total: item.total,
        count: item.count,
      })),
    [data?.trend, i18n.language],
  );

  if (!data) return null;

  const below = Math.round(data.cutoff * 100);
  const linkFor = (month: string, payee?: string) =>
    buildTransactionsLink({ month, type: 'E', below, payee });

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6">{t('insights.smallSpends.title')}</Typography>
        <Typography variant="body2" color="text.secondary" mb={1}>
          {t('insights.smallSpends.subtitle', {
            cutoff: formatCurrency.invoke(data.cutoff),
          })}
        </Typography>
        {data.count === 0 ? (
          <Typography color="text.secondary">
            {t('insights.smallSpends.none')}
          </Typography>
        ) : (
          <Typography variant="h5" component="div">
            <FigureLink to={linkFor(ym)}>
              {t('insights.smallSpends.headline', {
                count: data.count,
                total: formatCurrency.invoke(data.total),
              })}
            </FigureLink>
          </Typography>
        )}
        {data.typical_total !== null && data.typical_count !== null && (
          <Typography variant="caption" color="text.secondary">
            {t('insights.smallSpends.typical', {
              count: data.typical_count,
              total: formatCurrency.invoke(data.typical_total),
            })}
          </Typography>
        )}
        <Stack direction={{ xs: 'column', md: 'row' }} gap={3} mt={2}>
          {data.places.length > 0 && (
            <Box flex={1}>
              <Typography variant="subtitle2" mb={1}>
                {t('insights.smallSpends.places')}
              </Typography>
              <Stack gap={0.5}>
                {data.places.map((place) => (
                  <Stack
                    key={place.payee_key}
                    direction="row"
                    justifyContent="space-between"
                    gap={2}
                  >
                    <Typography variant="body2" noWrap>
                      <FigureLink
                        to={
                          place.payee_key === ''
                            ? null
                            : linkFor(ym, place.payee_key)
                        }
                      >
                        {place.payee_key === ''
                          ? t('insights.smallSpends.noDescription')
                          : place.name}
                      </FigureLink>
                      {` · ${t('insights.smallSpends.count', { count: place.count })}`}
                    </Typography>
                    <Typography variant="body2">
                      {formatCurrency.invoke(place.total)}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>
          )}
          <Box flex={1}>
            <Typography variant="subtitle2" mb={1}>
              {t('insights.smallSpends.trend')}
            </Typography>
            <Box height={120}>
              <ResponsiveBar<TrendDatum>
                data={chartData}
                keys={['total']}
                indexBy="ym"
                margin={{ top: 4, right: 4, bottom: 24, left: 4 }}
                padding={0.25}
                colors={(bar) =>
                  bar.indexValue === ym
                    ? theme.palette.primary.main
                    : `${theme.palette.primary.main}99`
                }
                enableLabel={false}
                enableGridY={false}
                axisLeft={null}
                axisBottom={{
                  tickSize: 0,
                  tickPadding: 4,
                  format: (value) =>
                    chartData.find((d) => d.ym === value)?.label ??
                    String(value),
                }}
                onClick={(bar) => navigate(linkFor(String(bar.indexValue)))}
                tooltip={({ data: d }) => (
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
                      {`${formatCurrency.invoke(d.total)} · ${t('insights.smallSpends.count', { count: d.count })}`}
                    </Typography>
                  </Box>
                )}
                theme={{
                  text: { fill: theme.palette.text.secondary },
                  axis: { ticks: { text: { fontSize: 10 } } },
                }}
              />
            </Box>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default SmallSpendsCard;
