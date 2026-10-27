import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import DataCard from '../../components/DataCard.tsx';
import { PanelTitle } from '../../theme/styled.ts';
import { useGetAccounts } from '../../services/account/accountHooks.ts';
import { ROUTE_IMPORT_TRX } from '../../providers/RoutesProvider.tsx';

/** Lists accounts whose transactions look out of date. Renders nothing when none are stale. */
const NeedsUpdatingCard = () => {
  const { t } = useTranslation();
  const accountsRequest = useGetAccounts();
  const staleAccounts = (accountsRequest.data ?? []).filter(
    (account) => account.freshness === 'stale',
  );

  if (staleAccounts.length === 0) return null;

  return (
    <DataCard>
      <PanelTitle>{t('dashboard.needsUpdatingTitle')}</PanelTitle>
      <Typography variant="body2" color="text.secondary" mb={1}>
        {t('dashboard.needsUpdatingSubtitle')}
      </Typography>
      <Stack spacing={1}>
        {staleAccounts.map((account) => (
          <Stack
            key={String(account.account_id)}
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            gap={1}
          >
            <Stack>
              <Typography variant="body1">{account.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {account.days_since_last_transaction == null
                  ? t('dashboard.needsUpdatingNone')
                  : t('dashboard.needsUpdatingDays', {
                      count: account.days_since_last_transaction,
                    })}
              </Typography>
            </Stack>
            <Button
              size="small"
              variant="outlined"
              component={RouterLink}
              to={ROUTE_IMPORT_TRX}
            >
              {t('dashboard.needsUpdatingImport')}
            </Button>
          </Stack>
        ))}
      </Stack>
    </DataCard>
  );
};

export default NeedsUpdatingCard;
