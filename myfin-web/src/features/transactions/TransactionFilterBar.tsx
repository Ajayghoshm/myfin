import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Badge from '@mui/material/Badge';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { ChevronLeft, ChevronRight, MoreVert } from '@mui/icons-material';
import { Account } from '../../services/auth/authServices.ts';
import { Category } from '../../services/category/categoryServices.ts';
import { categoryPickerItems } from '../../services/category/categoryTree.ts';
import { TransactionGroupBy } from '../../services/trx/trxServices.ts';
import {
  currentYearMonth,
  istDayOf,
  istDayStart,
  nextYearMonth,
  previousYearMonth,
} from '../../utils/istMonth.ts';

export const GROUP_BY_OPTIONS: TransactionGroupBy[] = [
  'payee',
  'category',
  'account',
  'month',
  'type',
];

type Props = {
  month: string | null;
  range: { from: number; to: number } | null;
  category: string | null;
  account: string | null;
  /** Search box shown first in the row. */
  search?: ReactNode;
  categories: Category[];
  accounts: Account[];
  /** Sets several URL params at once; null removes one. */
  onChange: (updates: Record<string, string | null>) => void;
};

/** Group-by choice; all state lives in the URL. */
export const GroupByToggle = (props: {
  groupBy: TransactionGroupBy | null;
  onChange: (updates: Record<string, string | null>) => void;
}) => {
  const { t } = useTranslation();
  return (
    <Stack direction="row" alignItems="center" gap={1}>
      <Typography variant="body2" color="text.secondary">
        {t('transactions.groupBy')}
      </Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={props.groupBy ?? 'none'}
        onChange={(_event, value: TransactionGroupBy | 'none' | null) => {
          if (value === null) return;
          props.onChange({ group: value === 'none' ? null : value });
        }}
      >
        <ToggleButton value="none">{t('transactions.groupNone')}</ToggleButton>
        {GROUP_BY_OPTIONS.map((option) => (
          <ToggleButton key={option} value={option}>
            {t(`transactions.groupBy_${option}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Stack>
  );
};

/** Search, account, category and month in one row; the date range sits in a ⋮ menu. */
const TransactionFilterBar = (props: Props) => {
  const { t } = useTranslation();
  const { range } = props;
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const fromDay = range ? istDayOf(range.from) : '';
  const toDay = range ? istDayOf(range.to - 1) : '';

  // an empty side falls back to the other, so a half-filled range still filters
  const setRange = (from: string, to: string) => {
    if (!from && !to) {
      props.onChange({ range: null });
      return;
    }
    const start = istDayStart(from || to);
    const end = istDayStart(to || from) + 86400;
    props.onChange({
      range: end > start ? `${start}-${end}` : null,
      month: null,
      day: null,
    });
  };
  const setMonth = (month: string | null) =>
    props.onChange({ month, range: null, day: null });

  return (
    <Stack direction="row" gap={2} flexWrap="wrap" alignItems="center">
      {props.search}
      <TextField
        select
        size="small"
        label={t('transactions.filterAccount')}
        value={props.account ?? ''}
        onChange={(event) =>
          props.onChange({ account: event.target.value || null })
        }
        sx={{ minWidth: 160 }}
      >
        <MenuItem value="">{t('transactions.filterAll')}</MenuItem>
        {props.accounts.map((account) => (
          <MenuItem
            key={String(account.account_id)}
            value={String(account.account_id)}
          >
            {account.name}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        label={t('transactions.filterCategory')}
        value={props.category ?? ''}
        onChange={(event) =>
          props.onChange({ category: event.target.value || null })
        }
        sx={{ minWidth: 180 }}
      >
        <MenuItem value="">{t('transactions.filterAll')}</MenuItem>
        <MenuItem value="none">
          {t('transactions.filterUncategorised')}
        </MenuItem>
        {categoryPickerItems(props.categories).map(({ category, label }) => (
          <MenuItem
            key={String(category.category_id)}
            value={String(category.category_id)}
          >
            {label}
          </MenuItem>
        ))}
      </TextField>
      <Stack direction="row" alignItems="center">
        <IconButton
          size="small"
          aria-label={t('transactions.previousMonth')}
          onClick={() =>
            setMonth(previousYearMonth(props.month ?? currentYearMonth()))
          }
        >
          <ChevronLeft />
        </IconButton>
        <TextField
          size="small"
          type="month"
          label={t('transactions.month')}
          value={props.month ?? ''}
          onChange={(event) => setMonth(event.target.value || null)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <IconButton
          size="small"
          aria-label={t('transactions.nextMonth')}
          onClick={() =>
            setMonth(nextYearMonth(props.month ?? currentYearMonth()))
          }
        >
          <ChevronRight />
        </IconButton>
      </Stack>
      <IconButton
        aria-label={t('transactions.moreFilters')}
        title={t('transactions.moreFilters')}
        onClick={(event) => setMenuAnchor(event.currentTarget)}
      >
        <Badge color="primary" variant="dot" invisible={!range}>
          <MoreVert />
        </Badge>
      </IconButton>
      <Popover
        open={menuAnchor !== null}
        anchorEl={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Stack gap={2} sx={{ p: 2 }}>
          <Typography variant="subtitle2">
            {t('transactions.dateRange')}
          </Typography>
          <Stack direction="row" alignItems="center" gap={1}>
            <TextField
              size="small"
              type="date"
              label={t('transactions.dateFrom')}
              value={fromDay}
              onChange={(event) => setRange(event.target.value, toDay)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <Typography color="text.secondary">–</Typography>
            <TextField
              size="small"
              type="date"
              label={t('transactions.dateTo')}
              value={toDay}
              onChange={(event) => setRange(fromDay, event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
        </Stack>
      </Popover>
    </Stack>
  );
};

export default TransactionFilterBar;
