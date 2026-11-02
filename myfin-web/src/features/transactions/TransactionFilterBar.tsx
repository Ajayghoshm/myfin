import { useTranslation } from 'react-i18next';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { ChevronLeft, ChevronRight } from '@mui/icons-material';
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
  groupBy: TransactionGroupBy | null;
  categories: Category[];
  accounts: Account[];
  /** Sets several URL params at once; null removes one. */
  onChange: (updates: Record<string, string | null>) => void;
};

/** Month, date range, category/account and grouping controls; all state lives in the URL. */
const TransactionFilterBar = (props: Props) => {
  const { t } = useTranslation();
  const { range } = props;
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
          <ToggleButton value="none">
            {t('transactions.groupNone')}
          </ToggleButton>
          {GROUP_BY_OPTIONS.map((option) => (
            <ToggleButton key={option} value={option}>
              {t(`transactions.groupBy_${option}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>
    </Stack>
  );
};

export default TransactionFilterBar;
