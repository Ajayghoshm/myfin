import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import DataCard from '../../components/DataCard.tsx';
import { ROUTE_REVIEW } from '../../providers/RoutesProvider.tsx';
import { useGetReview } from '../../services/insights/insightsHooks.ts';
import { PanelTitle } from '../../theme/styled.ts';
import { currentIstDay } from '../../utils/istMonth.ts';

/** Last day of the month on which the previous month's review is still offered. */
const LAST_REVIEW_DAY = 10;

const MonthReviewCard = () => {
  const { t, i18n } = useTranslation();
  const visible = currentIstDay() <= LAST_REVIEW_DAY;
  const { data } = useGetReview(undefined, visible);

  if (!visible || !data || data.complete || data.before_data) return null;

  const monthName = dayjs(`${data.month}-01`)
    .toDate()
    .toLocaleString(i18n.language, { month: 'long' });
  const next = data.steps.find((s) => s.status === 'todo');

  return (
    <DataCard>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="baseline"
        gap={1}
      >
        <PanelTitle>
          {t('review.cardTitle', {
            month: monthName,
            done: data.done,
            total: data.total,
          })}
        </PanelTitle>
        <Link
          component={RouterLink}
          to={ROUTE_REVIEW}
          underline="hover"
          variant="body2"
        >
          {t('review.openReview')}
        </Link>
      </Stack>
      {next ? (
        <Typography variant="body2" color="text.secondary">
          {t(`review.details.${next.detail_key}`, {
            ...next.detail_params,
            defaultValue: next.detail,
          })}
        </Typography>
      ) : null}
    </DataCard>
  );
};

export default MonthReviewCard;
