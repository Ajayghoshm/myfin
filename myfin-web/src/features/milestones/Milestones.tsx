import { EmojiEventsOutlined } from '@mui/icons-material';
import { useTheme } from '@mui/material';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader.tsx';
import { useGetMilestones } from '../../services/milestones/milestoneHooks.ts';
import { useMilestoneLabel } from './useMilestoneLabel.ts';

/** Timeline of every milestone reached, newest first. */
const Milestones = () => {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const label = useMilestoneLabel();
  const { data, isError } = useGetMilestones();
  const date = (epoch: number) =>
    new Date(epoch * 1000).toLocaleDateString(i18n.language, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  return (
    <Paper elevation={0} sx={{ p: theme.spacing(2), m: theme.spacing(2) }}>
      <PageHeader
        title={t('milestones.title')}
        subtitle={t('milestones.subtitle')}
      />
      {isError && (
        <Typography color="error">
          {t('common.somethingWentWrongTryAgain')}
        </Typography>
      )}
      {data && data.length === 0 && (
        <Typography color="text.secondary">{t('milestones.empty')}</Typography>
      )}
      <Stack divider={<Divider flexItem />}>
        {data?.map((m) => (
          <Stack
            key={m.milestone_id}
            direction="row"
            alignItems="center"
            gap={2}
            py={1}
          >
            <EmojiEventsOutlined color="success" />
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ minWidth: 110 }}
            >
              {date(m.achieved_at)}
            </Typography>
            <Typography variant="body1">{label(m)}</Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
};

export default Milestones;
