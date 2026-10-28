import {
  CheckCircleOutlined,
  RadioButtonUnchecked,
  RemoveCircleOutline,
} from '@mui/icons-material';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import type { ReviewStep } from '../../services/insights/insightsServices.ts';

const StatusIcon = ({ status }: { status: ReviewStep['status'] }) => {
  const { t } = useTranslation();
  const label = t(`review.status.${status}`);
  if (status === 'done')
    return <CheckCircleOutlined color="success" aria-label={label} />;
  if (status === 'nothing_to_do')
    return <RemoveCircleOutline color="disabled" aria-label={label} />;
  return <RadioButtonUnchecked color="warning" aria-label={label} />;
};

type Props = {
  step: ReviewStep;
  /** Only the "reviewed Insights" step can be ticked, and only while the month is open. */
  onToggleReviewed?: (reviewed: boolean) => void;
  disabled?: boolean;
};

/** One review step: status icon, name, what's left, and links to do it. */
const ReviewStepRow = ({ step, onToggleReviewed, disabled }: Props) => {
  const { t } = useTranslation();
  const detail = t(`review.details.${step.detail_key}`, {
    ...step.detail_params,
    defaultValue: step.detail,
  });
  return (
    <Stack direction="row" gap={1.5} alignItems="flex-start" py={1}>
      <StatusIcon status={step.status} />
      <Stack flex={1} minWidth={0}>
        <Typography variant="body1">{t(`review.steps.${step.key}`)}</Typography>
        <Typography variant="body2" color="text.secondary">
          {detail}
        </Typography>
        {step.items?.map((item) => (
          <Link
            key={item.id}
            component={RouterLink}
            to={item.link}
            underline="hover"
            variant="body2"
          >
            {item.label}
          </Link>
        ))}
        {onToggleReviewed ? (
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={step.status === 'done'}
                disabled={disabled}
                onChange={(e) => onToggleReviewed(e.target.checked)}
              />
            }
            label={t('review.tickReviewed')}
          />
        ) : null}
      </Stack>
      {step.status === 'todo' ? (
        <Link
          component={RouterLink}
          to={step.link}
          underline="hover"
          variant="body2"
          sx={{ whiteSpace: 'nowrap' }}
        >
          {t('review.open')}
        </Link>
      ) : null}
    </Stack>
  );
};

export default ReviewStepRow;
