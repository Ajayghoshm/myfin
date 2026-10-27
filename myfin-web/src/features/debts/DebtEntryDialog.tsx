import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DatePicker } from '@mui/x-date-pickers';
import dayjs, { Dayjs } from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertSeverity,
  useSnackbar,
} from '../../providers/SnackbarProvider.tsx';
import {
  useCreateDebt,
  useUpdateDebt,
} from '../../services/debts/debtHooks.ts';
import type {
  Debt,
  PeopleDebtKind,
} from '../../services/debts/debtServices.ts';
import { apiErrorMessage } from '../../utils/apiErrorMessage.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import {
  formatDay,
  fromEpoch,
  personFromDescription,
  toEpoch,
} from './debtDates.ts';

/** The transaction an entry is made from (Transactions row action). */
export type DebtSourceTransaction = {
  transactionId: string;
  type: 'E' | 'I';
  description?: string;
  amount: number;
  date: number;
};

type Props = {
  onClose: () => void;
  /** Edit this entry. */
  debt?: Debt;
  /** Create the entry from this transaction. */
  transaction?: DebtSourceTransaction;
};

const DebtEntryDialog = ({ onClose, debt, transaction }: Props) => {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const formatCurrency = useFormatNumberAsCurrency();
  const create = useCreateDebt();
  const update = useUpdateDebt();
  // An entry made from a transaction takes its amount and date from it
  const fromTransaction =
    transaction !== undefined || debt?.transaction_id != null;

  const [kind, setKind] = useState<PeopleDebtKind>(
    debt
      ? (debt.kind as PeopleDebtKind)
      : transaction?.type === 'I'
        ? 'borrowed'
        : 'lent',
  );
  const [name, setName] = useState(
    debt?.counterparty_name ?? personFromDescription(transaction?.description),
  );
  const [amount, setAmount] = useState(debt ? String(debt.principal) : '');
  const [date, setDate] = useState<Dayjs | null>(
    debt ? fromEpoch(debt.start_date) : dayjs(),
  );
  const [dueDate, setDueDate] = useState<Dayjs | null>(
    fromEpoch(debt?.due_date),
  );
  const [note, setNote] = useState(debt?.note ?? '');

  const onError = (error: unknown) =>
    snackbar.showSnackbar(
      apiErrorMessage(error, t('common.somethingWentWrongTryAgain')),
      AlertSeverity.ERROR,
    );

  const handleSave = () => {
    const amountNumber = Number(amount);
    const startEpoch = toEpoch(date);
    if (
      !name.trim() ||
      (!fromTransaction && (!(amountNumber > 0) || startEpoch === null))
    ) {
      snackbar.showSnackbar(
        t('common.fillAllFieldsTryAgain'),
        AlertSeverity.ERROR,
      );
      return;
    }
    const common = {
      name: name.trim(),
      due_date: toEpoch(dueDate),
      note: note.trim() || null,
    };
    const manual = fromTransaction
      ? {}
      : { amount: amountNumber, date: startEpoch ?? undefined };
    if (debt) {
      update.mutate(
        { id: debt.debt_id, data: { ...common, ...manual } },
        { onSuccess: onClose, onError },
      );
    } else {
      create.mutate(
        {
          kind,
          ...common,
          ...manual,
          ...(transaction
            ? { transaction_id: Number(transaction.transactionId) }
            : {}),
        },
        {
          onSuccess: () => {
            snackbar.showSnackbar(t('debts.saved'), AlertSeverity.SUCCESS);
            onClose();
          },
          onError,
        },
      );
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {debt
          ? t('debts.editEntry')
          : transaction
            ? t('debts.markAsDebtTitle')
            : t('debts.addEntry')}
      </DialogTitle>
      <DialogContent>
        <Stack gap={2} pt={1}>
          {transaction && (
            <Typography variant="body2" color="text.secondary">
              {t('debts.fromTransaction', {
                description: transaction.description ?? '',
                amount: formatCurrency.invoke(transaction.amount),
                date: formatDay(transaction.date),
              })}
            </Typography>
          )}
          <TextField
            select
            label={t('debts.kind')}
            value={kind}
            disabled={debt !== undefined || transaction !== undefined}
            onChange={(e) => setKind(e.target.value as PeopleDebtKind)}
          >
            <MenuItem value="lent">{t('debts.kindLent')}</MenuItem>
            <MenuItem value="borrowed">{t('debts.kindBorrowed')}</MenuItem>
          </TextField>
          <TextField
            label={t('debts.person')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          {!fromTransaction && (
            <>
              <TextField
                label={t('debts.amount')}
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <DatePicker
                label={t('debts.date')}
                value={date}
                onChange={setDate}
                format="DD/MM/YYYY"
              />
            </>
          )}
          <DatePicker
            label={t('debts.dueDate')}
            value={dueDate}
            onChange={setDueDate}
            format="DD/MM/YYYY"
            slotProps={{ field: { clearable: true } }}
          />
          <TextField
            label={t('debts.note')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            multiline
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={create.isPending || update.isPending}
          onClick={handleSave}
        >
          {t('debts.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DebtEntryDialog;
