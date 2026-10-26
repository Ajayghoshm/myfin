import { useTheme } from '@mui/material';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { ResponsivePie } from '@nivo/pie';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import EmptyView from '../../components/EmptyView.tsx';
import { MonthInsights } from '../../services/insights/insightsServices.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { buildTransactionsLink } from './drillDown.ts';
import FigureLink from './FigureLink.tsx';
import { formatPercent } from './insightsFormat.ts';

type Props = {
  ym: string;
  data: MonthInsights;
};

type PieDatum = {
  id: string;
  label: string;
  value: number;
  color: string;
  link: string;
};

const PaymentMix = ({ ym, data }: Props) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const formatCurrency = useFormatNumberAsCurrency();

  const palette = useMemo(
    () => [
      theme.palette.primary.main,
      theme.palette.secondary.main,
      theme.palette.success.main,
      theme.palette.warning.main,
      theme.palette.info.main,
      theme.palette.error.main,
      theme.palette.text.disabled,
    ],
    [theme],
  );

  const items: PieDatum[] = useMemo(
    () =>
      data.payment_mix
        .filter((item) => item.amount > 0)
        .map((item, index) => ({
          id: item.account_id,
          label: item.name || t('insights.unknownAccount'),
          value: item.amount,
          color: palette[index % palette.length],
          link: buildTransactionsLink({
            month: ym,
            account: item.account_id,
            type: 'E',
          }),
        })),
    [data.payment_mix, palette, ym, t],
  );
  const total = items.reduce((acc, item) => acc + item.value, 0);

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="h6" mb={2}>
          {t('insights.paymentMix')}
        </Typography>
        {items.length === 0 ? (
          <Box height={200} display="flex">
            <EmptyView />
          </Box>
        ) : (
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} alignItems="center">
            <Box height={200} width={{ xs: '100%', sm: 200 }} flexShrink={0}>
              <ResponsivePie<PieDatum>
                data={items}
                margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                innerRadius={0.6}
                padAngle={1}
                cornerRadius={3}
                colors={(d) => d.data.color}
                enableArcLabels={false}
                enableArcLinkLabels={false}
                onClick={(d) => navigate(d.data.link)}
                onMouseEnter={(_, event) => {
                  event.currentTarget.style.cursor = 'pointer';
                }}
                tooltip={({ datum }) => (
                  <Paper sx={{ fontSize: '12px', p: theme.spacing(1), whiteSpace: 'nowrap' }}>
                    {datum.label}: <strong>{formatCurrency.invoke(datum.value)}</strong>
                  </Paper>
                )}
                theme={theme.nivo}
              />
            </Box>
            <Stack gap={1} width="100%" minWidth={0}>
              {items.map((item) => (
                <Stack key={item.id} direction="row" alignItems="center" gap={1}>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: item.color,
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="body2" noWrap sx={{ flexGrow: 1 }}>
                    <FigureLink to={item.link}>{item.label}</FigureLink>
                  </Typography>
                  <Typography variant="body2" fontWeight="bold" noWrap>
                    <FigureLink to={item.link}>
                      {formatCurrency.invoke(item.value)}
                    </FigureLink>
                  </Typography>
                  <Typography variant="caption" color="text.secondary" width={36} textAlign="right">
                    {formatPercent(total === 0 ? 0 : item.value / total)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};

export default PaymentMix;
