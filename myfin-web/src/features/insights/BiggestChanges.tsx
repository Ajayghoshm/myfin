import { useTheme } from '@mui/material';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import EmptyView from '../../components/EmptyView.tsx';
import { MonthInsights } from '../../services/insights/insightsServices.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { buildTransactionsLink, isActionablePayeeKey } from './drillDown.ts';
import FigureLink from './FigureLink.tsx';
import { formatSignedPercent } from './insightsFormat.ts';

type Props = {
  ym: string;
  data: MonthInsights;
};

type Change = MonthInsights['biggest_changes'][number];

const BiggestChanges = ({ ym, data }: Props) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();

  const linkFor = (change: Change): string | null => {
    if (change.kind === 'category') {
      return buildTransactionsLink({
        month: ym,
        type: 'E',
        category: change.key,
      });
    }
    if (!isActionablePayeeKey(change.key)) return null;
    return buildTransactionsLink({ month: ym, type: 'E', payee: change.key });
  };

  const labelFor = (change: Change) =>
    change.kind === 'category' && change.key === 'none'
      ? t('insights.uncategorised')
      : change.label;

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="h6" mb={2}>
          {t('insights.biggestChanges')}
        </Typography>
        {data.biggest_changes.length === 0 ? (
          <Box height={200} display="flex">
            <EmptyView />
          </Box>
        ) : (
          <Stack gap={1.5}>
            {data.biggest_changes.map((change) => {
              const up = change.amount > change.typical;
              const link = linkFor(change);
              return (
                <Stack
                  key={`${change.kind}-${change.key}`}
                  direction="row"
                  justifyContent="space-between"
                  gap={2}
                >
                  <Box minWidth={0}>
                    <Typography variant="body2" noWrap>
                      <FigureLink to={link}>{labelFor(change)}</FigureLink>
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {change.kind === 'category'
                        ? t('insights.category')
                        : t('insights.merchant')}
                      {' · '}
                      {t('insights.typicalValue', {
                        value: formatCurrency.invoke(change.typical),
                      })}
                    </Typography>
                  </Box>
                  <Box textAlign="right" flexShrink={0}>
                    <Typography variant="body2" fontWeight="bold">
                      <FigureLink to={link}>
                        {formatCurrency.invoke(change.amount)}
                      </FigureLink>
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        color: up
                          ? theme.palette.error.main
                          : theme.palette.success.main,
                      }}
                    >
                      {change.change_pct === null
                        ? t('insights.new')
                        : formatSignedPercent(change.change_pct)}
                    </Typography>
                  </Box>
                </Stack>
              );
            })}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};

export default BiggestChanges;
