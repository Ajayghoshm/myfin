import {
  Box,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import { useGetAccountsMonthChange } from '../services/account/accountHooks.ts';
import { useGetTopSummaryValues } from '../services/user/userHooks.ts';
import { useTranslation } from 'react-i18next';
import { useFormatNumberAsCurrency } from '../utils/textHooks.ts';

type SummaryView = 'total' | 'month';
const VIEW_STORAGE_KEY = 'myfin.topSummaryView';

const readView = (): SummaryView => {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'month'
      ? 'month'
      : 'total';
  } catch {
    return 'total';
  }
};

const TopSummary = () => {
  const { operatingFundsSum, investingSum, debtSum, netWorthSum } =
    useGetTopSummaryValues();
  const { t } = useTranslation();
  const formatNumberAsCurrency = useFormatNumberAsCurrency();
  const [view, setView] = useState<SummaryView>(readView);
  const monthChange = useGetAccountsMonthChange(view === 'month').data;

  const changeView = (_: unknown, next: SummaryView | null) => {
    if (!next) return;
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // the choice just is not remembered
    }
  };

  // Month view shows how far each figure moved this month, signed
  const show = (total: number, change: number | undefined) => {
    if (view === 'total') return formatNumberAsCurrency.invoke(total);
    if (change === undefined) return '…';
    const text = formatNumberAsCurrency.invoke(Math.abs(change));
    return change > 0 ? `+${text}` : change < 0 ? `-${text}` : text;
  };

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{ display: { xs: 'none', md: 'flex' } }}
    >
      <ToggleButtonGroup
        exclusive
        size="small"
        value={view}
        onChange={changeView}
        aria-label={t('topBar.netWorth')}
        sx={{ '& .MuiToggleButton-root': { px: 1, py: 0.25, fontSize: 12 } }}
      >
        <ToggleButton value="total">{t('topBar.viewTotal')}</ToggleButton>
        <ToggleButton value="month">{t('topBar.viewThisMonth')}</ToggleButton>
      </ToggleButtonGroup>
      <TopSummaryItem
        label={t('topBar.operatingFunds')}
        value={show(operatingFundsSum, monthChange?.operatingFunds)}
      />
      <TopSummaryItem
        label={t('topBar.investing')}
        value={show(investingSum, monthChange?.investing)}
      />
      <TopSummaryItem
        label={t('topBar.debt')}
        value={show(debtSum, monthChange?.debt)}
      />
      <TopSummaryItem
        label={t('topBar.netWorth')}
        value={show(netWorthSum, monthChange?.netWorth)}
      />
    </Stack>
  );
};

type TopSummaryItemProps = {
  label: string;
  value: string;
};

const TopSummaryItem = ({ label, value }: TopSummaryItemProps) => {
  const theme = useTheme();
  return (
    <Box
      borderRadius={1}
      sx={{
        px: 1.5,
        py: 0.75,
        background: theme.palette.background.paper,
      }}
    >
      <Stack direction="column" spacing={0}>
        <Typography
          variant="caption"
          sx={{ color: theme.palette.text.secondary, lineHeight: 1.3 }}
        >
          {label}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            color: theme.palette.text.primary,
            fontWeight: 500,
            lineHeight: 1.3,
          }}
        >
          {value}
        </Typography>
      </Stack>
    </Box>
  );
};

export default TopSummary;
