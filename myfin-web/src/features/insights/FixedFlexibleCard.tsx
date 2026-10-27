import { useTheme } from '@mui/material';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import {
  CostSplit,
  MonthInsights,
} from '../../services/insights/insightsServices.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { buildTransactionsLink } from './drillDown.ts';
import FigureLink from './FigureLink.tsx';

type Props = {
  ym: string;
  data: MonthInsights;
};

type Kind = keyof CostSplit;

const FixedFlexibleCard = ({ ym, data }: Props) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();

  const kinds: Array<{ kind: Kind; title: string; link: string }> = [
    {
      kind: 'fixed',
      title: t('insights.fixedLabel'),
      link: buildTransactionsLink({ month: ym, type: 'E', cost: 'fixed' }),
    },
    {
      kind: 'flexible',
      title: t('insights.flexibleLabel'),
      link: buildTransactionsLink({ month: ym, type: 'E', cost: 'flexible' }),
    },
    {
      kind: 'unsorted',
      title: t('insights.unsortedLabel'),
      link: buildTransactionsLink({ month: ym, type: 'E', category: 'none' }),
    },
  ];

  const renderDiff = (kind: Kind) => {
    const typical = data.typical_cost_split;
    if (typical === null) return t('insights.noTypical');
    const diff = data.cost_split[kind] - typical[kind];
    if (Math.abs(diff) < 0.5) return t('insights.sameAsTypical');
    // spending: lower is better
    const better = diff < 0;
    const diffText = `${diff > 0 ? '+' : '-'}${formatCurrency.invoke(Math.abs(diff))}`;
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
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" mb={1}>
          {t('insights.fixedVsFlexible')}
        </Typography>
        <Grid container spacing={2}>
          {kinds.map(({ kind, title, link }) => (
            <Grid key={kind} size={{ xs: 12, sm: 4 }}>
              {kind === 'unsorted' ? (
                <Tooltip title={t('insights.unsortedHint')} placement="top-start">
                  <Typography variant="body2" color="text.secondary">
                    {title}
                  </Typography>
                </Tooltip>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {title}
                </Typography>
              )}
              <Typography variant="h5" component="div" sx={{ my: 0.5 }}>
                <FigureLink to={link}>
                  {formatCurrency.invoke(data.cost_split[kind])}
                </FigureLink>
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {renderDiff(kind)}
              </Typography>
            </Grid>
          ))}
        </Grid>
      </CardContent>
    </Card>
  );
};

export default FixedFlexibleCard;
