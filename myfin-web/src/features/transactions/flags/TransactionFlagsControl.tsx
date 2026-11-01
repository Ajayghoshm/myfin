import {
  Box,
  Collapse,
  FormControlLabel,
  Link,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGetEvents } from '../../../services/events/eventHooks.ts';
import {
  canLinkEvent,
  canMarkInvestment,
  canMarkLoan,
  FlagChoice,
} from './flagsModel.ts';

const NEW_EVENT = 'new';

type Props = {
  value: FlagChoice;
  onChange: (value: FlagChoice) => void;
  trxType: 'E' | 'I' | 'T';
  /** Used as the default loan name. */
  description: string;
  /** Investing accounts only. */
  investingAccounts: { id: bigint; label: string }[];
  /** An investment cannot go into the account it is paid from. */
  fromAccountId?: bigint | null;
  /** An existing transaction changes type through the dialog's own fields. */
  showInvestment: boolean;
};

const TransactionFlagsControl = ({
  value,
  onChange,
  trxType,
  description,
  investingAccounts: allInvestingAccounts,
  fromAccountId,
  showInvestment,
}: Props) => {
  const { t } = useTranslation();
  const events = useGetEvents();
  const [open, setOpen] = useState(
    value.kind !== 'none' || value.event != null,
  );

  const investingAccounts = allInvestingAccounts.filter(
    (account) => account.id !== fromAccountId,
  );
  const loanAllowed = canMarkLoan(trxType);
  const investmentAllowed =
    showInvestment &&
    canMarkInvestment(trxType) &&
    investingAccounts.length > 0;
  const kind = value.kind === 'loan' && !loanAllowed ? 'none' : value.kind;
  const investmentHint = !showInvestment
    ? null
    : !canMarkInvestment(trxType)
      ? t('transactions.flags.investmentExpenseOnly')
      : investingAccounts.length === 0
        ? t('transactions.flags.noInvestingAccount')
        : null;

  const eventSelect =
    value.event == null
      ? ''
      : 'new_event' in value.event
        ? NEW_EVENT
        : value.event.event_id;

  const setKind = (next: FlagChoice['kind'], on: boolean) => {
    if (!on) return onChange({ ...value, kind: 'none' });
    onChange({
      ...value,
      kind: next,
      loanName: next === 'loan' ? (value.loanName ?? description) : undefined,
      investmentAccountId:
        next === 'investment'
          ? (value.investmentAccountId ?? Number(investingAccounts[0]?.id))
          : undefined,
    });
  };

  return (
    <Box>
      <Link
        component="button"
        type="button"
        variant="body2"
        onClick={() => setOpen((current) => !current)}
      >
        {t('transactions.flags.title')}
      </Link>
      <Collapse in={open}>
        <Box display="flex" flexDirection="column" gap={1} paddingTop={1}>
          <FormControlLabel
            disabled={!loanAllowed}
            control={
              <Switch
                checked={kind === 'loan'}
                onChange={(_, on) => setKind('loan', on)}
              />
            }
            label={t('transactions.flags.loan')}
          />
          {kind === 'loan' && (
            <TextField
              size="small"
              label={t('transactions.flags.loanName')}
              value={value.loanName ?? ''}
              onChange={(e) => onChange({ ...value, loanName: e.target.value })}
            />
          )}
          {showInvestment && (
            <FormControlLabel
              disabled={!investmentAllowed}
              control={
                <Switch
                  checked={kind === 'investment'}
                  onChange={(_, on) => setKind('investment', on)}
                />
              }
              label={t('transactions.flags.investment')}
            />
          )}
          {investmentHint && (
            <Typography variant="caption" color="text.secondary">
              {investmentHint}
            </Typography>
          )}
          {kind === 'investment' && (
            <TextField
              select
              size="small"
              label={t('transactions.flags.investmentAccount')}
              value={value.investmentAccountId ?? ''}
              onChange={(e) =>
                onChange({
                  ...value,
                  investmentAccountId: Number(e.target.value),
                })
              }
            >
              {investingAccounts.map((account) => (
                <MenuItem key={String(account.id)} value={Number(account.id)}>
                  {account.label}
                </MenuItem>
              ))}
            </TextField>
          )}
          {!canLinkEvent(trxType) ? (
            <Typography variant="caption" color="text.secondary">
              {t('transactions.flags.eventNotForIncome')}
            </Typography>
          ) : (
            <>
              <TextField
                select
                size="small"
                label={t('transactions.flags.event')}
                value={eventSelect}
                onChange={(e) => {
                  const next = e.target.value;
                  onChange({
                    ...value,
                    event:
                      next === ''
                        ? null
                        : next === NEW_EVENT
                          ? { new_event: { name: '' } }
                          : { event_id: next },
                  });
                }}
              >
                <MenuItem value="">{t('transactions.flags.noEvent')}</MenuItem>
                {(events.data ?? []).map((event) => (
                  <MenuItem key={event.event_id} value={event.event_id}>
                    {event.name}
                  </MenuItem>
                ))}
                <MenuItem value={NEW_EVENT}>
                  {t('transactions.flags.createEvent')}
                </MenuItem>
              </TextField>
              {value.event && 'new_event' in value.event && (
                <TextField
                  size="small"
                  label={t('transactions.flags.newEventName')}
                  required
                  error={!value.event.new_event.name.trim()}
                  helperText={
                    value.event.new_event.name.trim()
                      ? undefined
                      : t('transactions.flags.newEventNameRequired')
                  }
                  value={value.event.new_event.name}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      event: { new_event: { name: e.target.value } },
                    })
                  }
                />
              )}
            </>
          )}
        </Box>
      </Collapse>
    </Box>
  );
};

export default TransactionFlagsControl;
