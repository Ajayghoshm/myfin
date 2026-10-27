import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ROUTE_LEGACY_PRINT } from '../../providers/RoutesProvider.tsx';
import {
  useDeleteLegacyEntry,
  useGetLegacy,
} from '../../services/legacy/legacyHooks.ts';
import type {
  LegacyData,
  LegacyEntry,
  LegacyKind,
} from '../../services/legacy/legacyServices.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import LegacyEntryDialog from './LegacyEntryDialog.tsx';

type DialogState = {
  kind: LegacyKind;
  entry?: LegacyEntry;
  accountId?: string;
  initial?: LegacyData;
} | null;

const summary = (entry: LegacyEntry) =>
  Object.values(entry.data)
    .filter((v) => v !== null && v !== '')
    .join(' · ');

const LegacyFile = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const formatCurrency = useFormatNumberAsCurrency();
  const { data } = useGetLegacy();
  const remove = useDeleteLegacyEntry();
  const [dialog, setDialog] = useState<DialogState>(null);

  if (!data) return null;
  const byKind = (kind: LegacyKind) =>
    data.entries.filter((e) => e.kind === kind);

  const row = (entry: LegacyEntry, label?: string) => (
    <Stack
      key={entry.entry_id}
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      gap={1}
    >
      <Box>
        {label && <Typography variant="subtitle2">{label}</Typography>}
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {summary(entry)}
        </Typography>
      </Box>
      <Box sx={{ flexShrink: 0 }}>
        <Button
          size="small"
          onClick={() =>
            setDialog({
              kind: entry.kind,
              entry,
              accountId: entry.account_id ?? undefined,
            })
          }
        >
          {t('common.edit')}
        </Button>
        <Button
          size="small"
          color="error"
          onClick={() => remove.mutate(entry.entry_id)}
        >
          {t('common.delete')}
        </Button>
      </Box>
    </Stack>
  );

  const heading = (key: string, kind?: LegacyKind) => (
    <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Typography variant="h6">{t(key)}</Typography>
      {kind && (
        <Button size="small" onClick={() => setDialog({ kind })}>
          {t('common.add')}
        </Button>
      )}
    </Stack>
  );

  return (
    <Stack spacing={2} sx={{ width: '100%' }}>
      <Alert severity="warning">{t('profile.legacy.banner')}</Alert>
      <Box>
        <Button
          variant="contained"
          onClick={() => navigate(ROUTE_LEGACY_PRINT)}
        >
          {t('profile.legacy.openPrint')}
        </Button>
      </Box>

      {heading('profile.legacy.accounts')}
      {data.accounts.map((account) => {
        const entry = byKind('account').find(
          (e) => e.account_id === account.account_id,
        );
        return entry ? (
          row(
            entry,
            `${account.name} (${formatCurrency.invoke(account.balance)})`,
          )
        ) : (
          <Stack
            key={account.account_id}
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="subtitle2">
              {account.name} ({formatCurrency.invoke(account.balance)})
            </Typography>
            <Button
              size="small"
              onClick={() =>
                setDialog({ kind: 'account', accountId: account.account_id })
              }
            >
              {t('common.add')}
            </Button>
          </Stack>
        );
      })}
      <Divider />

      {heading('profile.legacy.policies', 'policy')}
      {data.suggestions.length > 0 && (
        <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
          <Typography variant="caption">
            {t('profile.legacy.suggestions')}
          </Typography>
          {data.suggestions.map((s) => (
            <Chip
              key={s.payee_key}
              size="small"
              label={`${s.payee_key} (${formatCurrency.invoke(s.last_amount)})`}
              onClick={() =>
                setDialog({ kind: 'policy', initial: { insurer: s.payee_key } })
              }
            />
          ))}
        </Stack>
      )}
      {byKind('policy').map((e) => row(e))}
      <Divider />

      {heading('profile.legacy.loans')}
      <Typography variant="caption">{t('profile.legacy.liveNote')}</Typography>
      {data.debts.loans.length === 0 && (
        <Typography variant="body2">{t('profile.legacy.none')}</Typography>
      )}
      {data.debts.loans.map((l) => (
        <Typography key={l.debt_id} variant="body2">
          {l.lender}: {formatCurrency.invoke(l.outstanding_principal)} ·{' '}
          {t('profile.legacy.emi')} {formatCurrency.invoke(l.emi)} ·{' '}
          {t('profile.legacy.endsOn')} {l.end_date}
        </Typography>
      ))}
      <Divider />

      {heading('profile.legacy.people')}
      {data.debts.people.length === 0 && (
        <Typography variant="body2">{t('profile.legacy.none')}</Typography>
      )}
      {data.debts.people.map((d) => (
        <Typography key={d.debt_id} variant="body2">
          {d.counterparty_name}:{' '}
          {t(`profile.legacy.${d.kind === 'lent' ? 'owesYou' : 'youOwe'}`)}{' '}
          {formatCurrency.invoke(d.outstanding)}
        </Typography>
      ))}
      <Divider />

      {heading('profile.legacy.contacts', 'contact')}
      {byKind('contact').map((e) => row(e))}
      <Divider />

      {heading('profile.legacy.instructions', 'instruction')}
      {byKind('instruction').map((e) => row(e))}

      {dialog && (
        <LegacyEntryDialog
          key={dialog.entry?.entry_id ?? `${dialog.kind}-${dialog.accountId}`}
          kind={dialog.kind}
          entry={dialog.entry}
          accountId={dialog.accountId}
          initial={dialog.initial}
          onClose={() => setDialog(null)}
        />
      )}
    </Stack>
  );
};

export default LegacyFile;
