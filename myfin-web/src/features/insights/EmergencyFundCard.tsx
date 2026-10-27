import { useTheme } from '@mui/material';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import DataCard from '../../components/DataCard.tsx';
import { useGetEmergencyFund } from '../../services/insights/insightsHooks.ts';
import { PanelTitle } from '../../theme/styled.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';

/** How many months of typical fixed costs the emergency-fund accounts cover. */
const EmergencyFundCard = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const formatCurrency = useFormatNumberAsCurrency();
  const { data } = useGetEmergencyFund();

  if (!data) return null;

  const colors = {
    red: theme.palette.error.main,
    amber: theme.palette.warning.main,
    green: theme.palette.success.main,
  } as const;

  const renderBody = () => {
    if (data.status === 'no_accounts')
      return (
        <Typography variant="body2" color="text.secondary">
          {t('emergencyFund.noAccounts')}
        </Typography>
      );
    if (data.status === 'no_fixed' || data.months_covered === null)
      return (
        <Typography variant="body2" color="text.secondary">
          {t('emergencyFund.noFixed', {
            fund: formatCurrency.invoke(data.fund),
          })}
        </Typography>
      );
    const color = colors[data.status];
    const pct = Math.min(100, (data.months_covered / data.target_months) * 100);
    return (
      <>
        <Typography variant="h5" sx={{ color }} mb={1}>
          {t('emergencyFund.monthsCovered', { count: data.months_covered })}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={pct}
          aria-label={t('emergencyFund.title')}
          sx={{
            height: 10,
            borderRadius: 5,
            mb: 1,
            '& .MuiLinearProgress-bar': { backgroundColor: color },
          }}
        />
        <Typography variant="body2" color="text.secondary">
          {data.more_needed > 0
            ? t('emergencyFund.moreNeeded', {
                amount: formatCurrency.invoke(data.more_needed),
                target: data.target_months,
              })
            : t('emergencyFund.targetReached', { target: data.target_months })}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('emergencyFund.fundOf', {
            fund: formatCurrency.invoke(data.fund),
            fixed: formatCurrency.invoke(data.monthly_fixed ?? 0),
          })}
        </Typography>
      </>
    );
  };

  return (
    <DataCard>
      <PanelTitle>{t('emergencyFund.title')}</PanelTitle>
      {renderBody()}
    </DataCard>
  );
};

export default EmergencyFundCard;
