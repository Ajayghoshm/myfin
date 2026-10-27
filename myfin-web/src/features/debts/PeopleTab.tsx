import { Close } from '@mui/icons-material';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DataCard from '../../components/DataCard.tsx';
import GenericConfirmationDialog from '../../components/GenericConfirmationDialog.tsx';
import {
  AlertSeverity,
  useSnackbar,
} from '../../providers/SnackbarProvider.tsx';
import {
  useAddRepayment,
  useDeleteDebt,
  useDeleteRepayment,
  useGetRepaymentSuggestions,
} from '../../services/debts/debtHooks.ts';
import type { Debt } from '../../services/debts/debtServices.ts';
import { PanelTitle } from '../../theme/styled.ts';
import { apiErrorMessage } from '../../utils/apiErrorMessage.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import DebtEntryDialog from './DebtEntryDialog.tsx';
import { formatDay } from './debtDates.ts';
import RepaymentDialog from './RepaymentDialog.tsx';

const statusColor = {
  outstanding: 'warning',
  settled: 'success',
  overdue: 'error',
} as const;

const useShowError = () => {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  return (error: unknown) =>
    snackbar.showSnackbar(
      apiErrorMessage(error, t('common.somethingWentWrongTryAgain')),
      AlertSeverity.ERROR,
    );
};

/** Transactions that look like repayments of this entry, to confirm one by one. */
const Suggestions = ({ debt }: { debt: Debt }) => {
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  const showError = useShowError();
  const { data } = useGetRepaymentSuggestions(
    debt.status === 'settled' ? null : debt.debt_id,
  );
  const addRepayment = useAddRepayment();
  if (!data || data.length === 0) return null;
  return (
    <Alert severity="info" sx={{ mt: 1 }}>
      <Typography variant="body2" mb={1}>
        {t('debts.suggestionsHelp')}
      </Typography>
      <Stack gap={1}>
        {data.map((s) => (
          <Stack
            key={s.transaction_id}
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            gap={1}
          >
            <Typography variant="body2">
              {`${s.description} · ${formatCurrency.invoke(s.amount)} · ${formatDay(s.date)}`}
            </Typography>
            <Button
              size="small"
              disabled={addRepayment.isPending}
              onClick={() =>
                addRepayment.mutate(
                  {
                    id: debt.debt_id,
                    data: { transaction_id: Number(s.transaction_id) },
                  },
                  { onError: showError },
                )
              }
            >
              {t('debts.confirmRepayment')}
            </Button>
          </Stack>
        ))}
      </Stack>
    </Alert>
  );
};

const Entry = (props: {
  debt: Debt;
  onEdit: () => void;
  onDelete: () => void;
  onRepay: () => void;
}) => {
  const { debt } = props;
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  const showError = useShowError();
  const deleteRepayment = useDeleteRepayment();

  return (
    <DataCard>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        gap={1}
      >
        <Stack gap={0.5}>
          <Stack direction="row" alignItems="center" gap={1}>
            <Typography variant="h6">{debt.counterparty_name}</Typography>
            <Chip
              size="small"
              color={statusColor[debt.display_status]}
              label={t(`debts.status.${debt.display_status}`)}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t(debt.kind === 'lent' ? 'debts.lentOn' : 'debts.borrowedOn', {
              amount: formatCurrency.invoke(debt.principal),
              date: formatDay(debt.start_date),
            })}
            {debt.due_date != null &&
              ` · ${t('debts.dueOn', { date: formatDay(debt.due_date) })}`}
          </Typography>
          {debt.note && (
            <Typography variant="body2" color="text.secondary">
              {debt.note}
            </Typography>
          )}
        </Stack>
        <Stack alignItems={{ xs: 'flex-start', sm: 'flex-end' }} gap={0.5}>
          <Typography variant="h6">
            {formatCurrency.invoke(debt.outstanding)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('debts.outstanding')}
          </Typography>
        </Stack>
      </Stack>

      {debt.payments.length > 0 && (
        <List dense disablePadding sx={{ mt: 1 }}>
          {debt.payments.map((p) => (
            <ListItem
              key={p.payment_id}
              disableGutters
              secondaryAction={
                <IconButton
                  size="small"
                  aria-label={t('debts.undoRepayment')}
                  title={t('debts.undoRepayment')}
                  disabled={deleteRepayment.isPending}
                  onClick={() =>
                    deleteRepayment.mutate(
                      { id: debt.debt_id, paymentId: p.payment_id },
                      { onError: showError },
                    )
                  }
                >
                  <Close fontSize="small" />
                </IconButton>
              }
            >
              <ListItemText
                primary={t('debts.repaymentRow', {
                  amount: formatCurrency.invoke(p.amount),
                  date: formatDay(p.date),
                })}
                secondary={
                  p.manual ? t('debts.manualRepayment') : (p.description ?? '')
                }
              />
            </ListItem>
          ))}
        </List>
      )}

      <Suggestions debt={debt} />

      <Stack direction="row" gap={1} mt={1} flexWrap="wrap">
        {debt.status !== 'settled' && (
          <Button size="small" onClick={props.onRepay}>
            {t('debts.addRepayment')}
          </Button>
        )}
        <Button size="small" onClick={props.onEdit}>
          {t('common.edit')}
        </Button>
        <Button size="small" color="error" onClick={props.onDelete}>
          {t('common.delete')}
        </Button>
      </Stack>
    </DataCard>
  );
};

const PeopleTab = (props: {
  debts: Debt[];
  totals: { owed_to_you: number; you_owe: number };
}) => {
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  const showError = useShowError();
  const remove = useDeleteDebt();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Debt | null>(null);
  const [repaying, setRepaying] = useState<Debt | null>(null);
  const [toDelete, setToDelete] = useState<Debt | null>(null);

  const people = props.debts.filter(
    (d) => d.kind === 'lent' || d.kind === 'borrowed',
  );
  // Open entries first, settled ones at the end
  const sorted = [...people].sort(
    (a, b) =>
      Number(a.status === 'settled') - Number(b.status === 'settled') ||
      b.start_date - a.start_date,
  );

  return (
    <Stack gap={2}>
      <DataCard>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          gap={1}
        >
          <Stack>
            <PanelTitle>{t('debts.peopleTitle')}</PanelTitle>
            <Typography variant="h6">
              {t('debts.totals', {
                owedToYou: formatCurrency.invoke(props.totals.owed_to_you),
                youOwe: formatCurrency.invoke(props.totals.you_owe),
              })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('debts.peopleHelp')}
            </Typography>
          </Stack>
          <Button variant="contained" onClick={() => setAdding(true)}>
            {t('debts.addEntry')}
          </Button>
        </Stack>
      </DataCard>

      {sorted.length === 0 && (
        <Alert severity="info">{t('debts.peopleEmpty')}</Alert>
      )}
      {sorted.map((d) => (
        <Entry
          key={d.debt_id}
          debt={d}
          onEdit={() => setEditing(d)}
          onDelete={() => setToDelete(d)}
          onRepay={() => setRepaying(d)}
        />
      ))}

      {adding && <DebtEntryDialog onClose={() => setAdding(false)} />}
      {editing && (
        <DebtEntryDialog debt={editing} onClose={() => setEditing(null)} />
      )}
      {repaying && (
        <RepaymentDialog debt={repaying} onClose={() => setRepaying(null)} />
      )}
      <GenericConfirmationDialog
        isOpen={toDelete !== null}
        onClose={() => setToDelete(null)}
        onNegativeClick={() => setToDelete(null)}
        onPositiveClick={() => {
          if (toDelete)
            remove.mutate(toDelete.debt_id, {
              onSuccess: () => setToDelete(null),
              onError: showError,
            });
        }}
        titleText={t('debts.deleteTitle')}
        descriptionText={t('debts.deleteDescription', {
          name: toDelete?.counterparty_name ?? '',
        })}
        alert={t('debts.deleteAlert')}
        positiveText={t('common.delete')}
      />
    </Stack>
  );
};

export default PeopleTab;
