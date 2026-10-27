import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
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
import { useAddRepayment } from '../../services/debts/debtHooks.ts';
import type { Debt } from '../../services/debts/debtServices.ts';
import { apiErrorMessage } from '../../utils/apiErrorMessage.ts';
import { toEpoch } from './debtDates.ts';

/** A repayment with no transaction behind it (e.g. repaid in cash). */
const RepaymentDialog = (props: { debt: Debt; onClose: () => void }) => {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const addRepayment = useAddRepayment();
  const [amount, setAmount] = useState(String(props.debt.outstanding || ''));
  const [date, setDate] = useState<Dayjs | null>(dayjs());

  const handleSave = () => {
    const amountNumber = Number(amount);
    const epoch = toEpoch(date);
    if (!(amountNumber > 0) || epoch === null) {
      snackbar.showSnackbar(
        t('common.fillAllFieldsTryAgain'),
        AlertSeverity.ERROR,
      );
      return;
    }
    addRepayment.mutate(
      { id: props.debt.debt_id, data: { amount: amountNumber, date: epoch } },
      {
        onSuccess: props.onClose,
        onError: (error) =>
          snackbar.showSnackbar(
            apiErrorMessage(error, t('common.somethingWentWrongTryAgain')),
            AlertSeverity.ERROR,
          ),
      },
    );
  };

  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {t('debts.manualRepaymentTitle', {
          name: props.debt.counterparty_name,
        })}
      </DialogTitle>
      <DialogContent>
        <Stack gap={2} pt={1}>
          <Typography variant="body2" color="text.secondary">
            {t('debts.manualRepaymentHelp')}
          </Typography>
          <TextField
            label={t('debts.amount')}
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
          <DatePicker
            label={t('debts.date')}
            value={date}
            onChange={setDate}
            format="DD/MM/YYYY"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={addRepayment.isPending}
          onClick={handleSave}
        >
          {t('debts.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RepaymentDialog;
