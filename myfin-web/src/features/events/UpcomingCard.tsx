import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import DataCard from '../../components/DataCard.tsx';
import { ROUTE_EVENTS } from '../../providers/RoutesProvider.tsx';
import { useGetUpcoming } from '../../services/events/eventHooks.ts';
import {
  isPeopleKind,
  type UpcomingItem,
} from '../../services/events/eventServices.ts';
import { PanelTitle } from '../../theme/styled.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';

const UPCOMING_DAYS = 30;

/** Dashboard list of events and loan EMIs due in the next 30 days. */
const UpcomingCard = () => {
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  const { data } = useGetUpcoming(UPCOMING_DAYS);

  if (!data || data.length === 0) return null;

  const line = (item: UpcomingItem) => {
    const name =
      item.source === 'emi'
        ? t('events.emiName', { name: item.name })
        : item.name;
    const when =
      item.days_until === 0
        ? t('events.today')
        : t('events.inDays', { count: item.days_until });
    const parts = [`${name} ${when}`];
    if (item.gift_budget != null)
      parts.push(
        t('events.budget', { amount: formatCurrency.invoke(item.gift_budget) }),
      );
    if (item.gift_spent)
      parts.push(
        t('events.spent', { amount: formatCurrency.invoke(item.gift_spent) }),
      );
    if (item.amount != null) parts.push(formatCurrency.invoke(item.amount));
    return parts.join(' · ');
  };

  return (
    <DataCard>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="baseline"
        gap={1}
      >
        <PanelTitle>
          {t('events.upcomingTitle', { days: UPCOMING_DAYS })}
        </PanelTitle>
        <Link
          component={RouterLink}
          to={ROUTE_EVENTS}
          underline="hover"
          variant="body2"
        >
          {t('events.seeAll')}
        </Link>
      </Stack>
      <Stack divider={<Divider flexItem />}>
        {data.map((item) => (
          <Stack
            key={`${item.source}:${item.id}:${item.date}`}
            direction="row"
            justifyContent="space-between"
            gap={1}
            py={0.75}
          >
            <Typography variant="body2">{line(item)}</Typography>
            {item.status === 'done' && (
              <Typography variant="body2" color="success.main" noWrap>
                {isPeopleKind(item.kind)
                  ? t('events.doneMark')
                  : t('events.paidMark')}
              </Typography>
            )}
          </Stack>
        ))}
      </Stack>
    </DataCard>
  );
};

export default UpcomingCard;
