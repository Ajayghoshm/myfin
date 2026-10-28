import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import DataCard from '../../components/DataCard.tsx';
import { ROUTE_HEALTH } from '../../providers/RoutesProvider.tsx';
import { useGetHealth } from '../../services/insights/insightsHooks.ts';
import { PanelTitle } from '../../theme/styled.ts';
import HealthCheckRow from './HealthCheckRow.tsx';

/** "Health N of M" for the current month, with the failing checks and their hints. */
const HealthScoreCard = () => {
  const { t } = useTranslation();
  const { data } = useGetHealth();

  if (!data) return null;

  if (data.total === 0)
    return (
      <Link
        component={RouterLink}
        to={ROUTE_HEALTH}
        underline="hover"
        variant="body2"
      >
        {t('health.setUpYourChecks')}
      </Link>
    );

  const failing = data.checks.filter((c) => c.status === 'fail');

  return (
    <DataCard>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="baseline"
        gap={1}
      >
        <PanelTitle>
          {t('health.cardTitle', { passed: data.passed, total: data.total })}
        </PanelTitle>
        <Link
          component={RouterLink}
          to={ROUTE_HEALTH}
          underline="hover"
          variant="body2"
        >
          {t('health.seeDetails')}
        </Link>
      </Stack>
      {failing.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('health.allPassed')}
        </Typography>
      ) : (
        <Stack divider={<Divider flexItem />}>
          {failing.map((c) => (
            <HealthCheckRow key={c.key} check={c} />
          ))}
        </Stack>
      )}
    </DataCard>
  );
};

export default HealthScoreCard;
