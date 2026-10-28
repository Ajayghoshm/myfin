import { EmojiEventsOutlined } from '@mui/icons-material';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { ROUTE_MILESTONES } from '../../providers/RoutesProvider.tsx';
import {
  AlertSeverity,
  useSnackbar,
} from '../../providers/SnackbarProvider.tsx';
import {
  useDismissMilestone,
  useEvaluateMilestones,
} from '../../services/milestones/milestoneHooks.ts';
import { useMilestoneLabel } from './useMilestoneLabel.ts';

/** Dashboard banners: evaluates milestones once per mount and shows each undismissed one until dismissed. */
const MilestoneBanner = () => {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const label = useMilestoneLabel();
  // A failed evaluate stays silent: no data, no banner
  const { data } = useEvaluateMilestones();
  const dismiss = useDismissMilestone();

  if (!data || data.length === 0) return null;

  const handleDismiss = (id: string) =>
    dismiss.mutate(id, {
      onError: () =>
        snackbar.showSnackbar(
          t('common.somethingWentWrongTryAgain'),
          AlertSeverity.ERROR,
        ),
    });

  return (
    <Stack gap={1}>
      {data.map((m) => (
        <Alert
          key={m.milestone_id}
          severity="success"
          variant="outlined"
          icon={<EmojiEventsOutlined fontSize="inherit" />}
          onClose={() => handleDismiss(m.milestone_id)}
          slotProps={{ closeButton: { title: t('milestones.dismiss') } }}
        >
          <AlertTitle>{t('milestones.bannerTitle')}</AlertTitle>
          {label(m)}{' '}
          <Link component={RouterLink} to={ROUTE_MILESTONES} underline="hover">
            {t('milestones.seeAll')}
          </Link>
        </Alert>
      ))}
    </Stack>
  );
};

export default MilestoneBanner;
