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
import { useGetAccounts } from '../../services/account/accountHooks.ts';
import {
  AccountStatus,
  AccountType,
} from '../../services/auth/authServices.ts';
import {
  useCreateLoan,
  useGetDisbursementCandidates,
} from '../../services/debts/debtHooks.ts';
import { apiErrorMessage } from '../../utils/apiErrorMessage.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { formatDay, toEpoch } from './debtDates.ts';

/** EMI in currency for a principal, annual rate (%) and months; 0 % splits evenly. */
export const estimateEmi = (
  principal: number,
  rate: number,
  months: number,
) => {
  if (!(principal > 0) || !(months > 0)) return null;
  const r = rate / 12 / 100;
  if (r === 0) return Math.ceil((principal * 100) / months) / 100;
  const f = (1 + r) ** months;
  return Math.round(((principal * r * f) / (f - 1)) * 100) / 100;
};

/** Adds a formal loan: lender, principal, rate, tenure, EMI, EMI day, paying account, first EMI month. */
const LoanDialog = (props: { onClose: () => void }) => {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const formatCurrency = useFormatNumberAsCurrency();
  const create = useCreateLoan();
  const accountsRequest = useGetAccounts();
  const payingAccounts = (accountsRequest.data ?? []).filter(
    (a) =>
      a.status === AccountStatus.Active &&
      a.type !== AccountType.Loan &&
      a.type !== AccountType.Investing,
  );

  const [lender, setLender] = useState('');
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [tenure, setTenure] = useState('');
  const [emi, setEmi] = useState('');
  const [emiDay, setEmiDay] = useState('5');
  const [accountId, setAccountId] = useState('');
  const [disbursementId, setDisbursementId] = useState('');
  const [firstMonth, setFirstMonth] = useState<Dayjs | null>(
    dayjs().startOf('month'),
  );

  const startEpoch = toEpoch(firstMonth ? firstMonth.startOf('month') : null);
  const disbursementCandidates = useGetDisbursementCandidates(startEpoch);
  // The list follows the first EMI month: a pick that is no longer offered is dropped
  const selectedDisbursementId = (disbursementCandidates.data ?? []).some(
    (c) => c.transaction_id === disbursementId,
  )
    ? disbursementId
    : '';

  const estimate = estimateEmi(Number(principal), Number(rate), Number(tenure));

  const handleSave = () => {
    const start = toEpoch(firstMonth ? firstMonth.startOf('month') : null);
    const day = Number(emiDay);
    if (
      lender.trim() === '' ||
      !(Number(principal) > 0) ||
      rate === '' ||
      !(Number(rate) >= 0) ||
      !Number.isInteger(Number(tenure)) ||
      !(Number(tenure) > 0) ||
      !Number.isInteger(day) ||
      day < 1 ||
      day > 31 ||
      accountId === '' ||
      start === null ||
      (emi !== '' && !(Number(emi) > 0))
    ) {
      snackbar.showSnackbar(
        t('common.fillAllFieldsTryAgain'),
        AlertSeverity.ERROR,
      );
      return;
    }
    create.mutate(
      {
        lender: lender.trim(),
        principal: Number(principal),
        rate: Number(rate),
        tenure_months: Number(tenure),
        emi: emi === '' ? null : Number(emi),
        emi_day: day,
        account_id: Number(accountId),
        start_date: start,
        disbursement_transaction_id:
          selectedDisbursementId === '' ? null : Number(selectedDisbursementId),
      },
      {
        onSuccess: () => {
          snackbar.showSnackbar(t('debts.loans.saved'), AlertSeverity.SUCCESS);
          props.onClose();
        },
        onError: (error) =>
          snackbar.showSnackbar(
            apiErrorMessage(error, t('common.somethingWentWrongTryAgain')),
            AlertSeverity.ERROR,
          ),
      },
    );
  };

  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('debts.loans.addLoan')}</DialogTitle>
      <DialogContent>
        <Stack gap={2} pt={1}>
          <Typography variant="body2" color="text.secondary">
            {t('debts.loans.addHelp')}
          </Typography>
          <TextField
            label={t('debts.loans.lender')}
            value={lender}
            onChange={(e) => setLender(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 255 } }}
            autoFocus
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
            <TextField
              fullWidth
              label={t('debts.loans.principal')}
              type="number"
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
            />
            <TextField
              fullWidth
              label={t('debts.loans.rate')}
              type="number"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              helperText={t('debts.loans.rateHelp')}
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
            <TextField
              fullWidth
              label={t('debts.loans.tenure')}
              type="number"
              value={tenure}
              onChange={(e) => setTenure(e.target.value)}
            />
            <TextField
              fullWidth
              label={t('debts.loans.emi')}
              type="number"
              value={emi}
              onChange={(e) => setEmi(e.target.value)}
              helperText={
                estimate !== null
                  ? t('debts.loans.emiEstimate', {
                      amount: formatCurrency.invoke(estimate),
                    })
                  : t('debts.loans.emiHelp')
              }
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
            <DatePicker
              label={t('debts.loans.firstEmiMonth')}
              value={firstMonth}
              onChange={setFirstMonth}
              views={['year', 'month']}
              format="MM/YYYY"
              sx={{ width: '100%' }}
            />
            <TextField
              fullWidth
              label={t('debts.loans.emiDay')}
              type="number"
              value={emiDay}
              onChange={(e) => setEmiDay(e.target.value)}
              slotProps={{ htmlInput: { min: 1, max: 31 } }}
            />
          </Stack>
          <TextField
            select
            label={t('debts.loans.payingAccount')}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {payingAccounts.map((a) => (
              <MenuItem key={String(a.account_id)} value={String(a.account_id)}>
                {a.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t('debts.loans.disbursementPicker')}
            value={selectedDisbursementId}
            onChange={(e) => setDisbursementId(e.target.value)}
            helperText={t('debts.loans.disbursementPickerHelp')}
          >
            <MenuItem value="">{t('debts.loans.noDisbursement')}</MenuItem>
            {(disbursementCandidates.data ?? []).map((c) => (
              <MenuItem key={c.transaction_id} value={c.transaction_id}>
                {`${c.description} · ${formatCurrency.invoke(c.amount)} · ${formatDay(c.date)}`}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={create.isPending}
          onClick={handleSave}
        >
          {t('debts.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default LoanDialog;
