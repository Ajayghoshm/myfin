import { useTheme } from '@mui/material';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import {
  InsightsRates,
  MonthInsights,
} from '../../services/insights/insightsServices.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { buildTransactionsLink } from './drillDown.ts';
import FigureLink from './FigureLink.tsx';
import { formatPercent } from './insightsFormat.ts';

type Props = {
  ym: string;
  data: MonthInsights;
};

type Metric = keyof InsightsRates;

const SummaryCards = ({ ym, data }: Props) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();

  const cards: Array<{
    metric: Metric;
    title: string;
    link: string;
    higherIsBetter: boolean;
  }> = [
    {
      metric: 'income',
      title: t('insights.income'),
      link: buildTransactionsLink({ month: ym, type: 'I' }),
      higherIsBetter: true,
    },
    {
      metric: 'spending',
      title: t('insights.spending'),
      link: buildTransactionsLink({ month: ym, type: 'E' }),
      higherIsBetter: false,
    },
    {
      metric: 'savings',
      title: t('insights.savings'),
      link: buildTransactionsLink({ month: ym }),
      higherIsBetter: true,
    },
    {
      metric: 'savings_rate',
      title: t('insights.savingsRate'),
      link: buildTransactionsLink({ month: ym }),
      higherIsBetter: true,
    },
  ];

  const formatValue = (metric: Metric, value: number | null) => {
    if (value === null) return '—';
    return metric === 'savings_rate'
      ? formatPercent(value)
      : formatCurrency.invoke(value);
  };

  const renderDiff = (metric: Metric, higherIsBetter: boolean) => {
    const value = data.summary[metric];
    const typical = data.typical?.[metric] ?? null;
    if (data.typical === null) {
      return t('insights.noTypical');
    }
    if (value === null || typical === null) {
      return t('insights.typicalValue', { value: formatValue(metric, typical) });
    }
    const diff = value - typical;
    if (Math.abs(diff) < (metric === 'savings_rate' ? 0.005 : 0.5)) {
      return t('insights.sameAsTypical');
    }
    const better = higherIsBetter ? diff > 0 : diff < 0;
    const diffText =
      metric === 'savings_rate'
        ? t('insights.points', {
            value: `${diff > 0 ? '+' : ''}${Math.round(diff * 100)}`,
          })
        : `${diff > 0 ? '+' : '-'}${formatCurrency.invoke(Math.abs(diff))}`;
    return (
      <span
        style={{
          color: better ? theme.palette.success.main : theme.palette.error.main,
        }}
      >
        {t('insights.vsTypical', { value: diffText })}
      </span>
    );
  };

  return (
    <Grid container spacing={2}>
      {cards.map((card) => (
        <Grid key={card.metric} size={{ xs: 12, sm: 6, md: 3 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                {card.title}
              </Typography>
              <Typography variant="h5" component="div" sx={{ my: 0.5 }}>
                <FigureLink to={card.link}>
                  {formatValue(card.metric, data.summary[card.metric])}
                </FigureLink>
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {renderDiff(card.metric, card.higherIsBetter)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
};

export default SummaryCards;
