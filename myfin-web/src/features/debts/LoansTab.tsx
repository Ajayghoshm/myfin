import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DataCard from '../../components/DataCard.tsx';
import GenericConfirmationDialog from '../../components/GenericConfirmationDialog.tsx';
import {
  AlertSeverity,
  useSnackbar,
} from '../../providers/SnackbarProvider.tsx';
import {
  useDeleteDebt,
  useGetDisbursementCandidates,
  useGetInstallmentCandidates,
  useGetLoanMatchSuggestions,
  useGetLoans,
  useGetPrepayment,
  useLinkDisbursement,
  useMarkInstallmentPaid,
  useMarkPastInstallmentsPaid,
  useMatchInstallment,
  useUnlinkDisbursement,
  useUnpayInstallment,
} from '../../services/debts/debtHooks.ts';
import type {
  Installment,
  Loan,
  LoanMatchSuggestion,
} from '../../services/debts/debtServices.ts';
import { PanelTitle } from '../../theme/styled.ts';
import { apiErrorMessage } from '../../utils/apiErrorMessage.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { formatDay } from './debtDates.ts';
import LoanDialog from './LoanDialog.tsx';
import TransactionPickerDialog from './TransactionPickerDialog.tsx';

/** "2026-10-05" → "05/10/2026". */
const formatDate = (date: string) => dayjs(date).format('DD/MM/YYYY');

const statusColor = {
  paid: 'success',
  due: 'default',
  missed: 'error',
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

/** What paying extra after an installment would save, with the same EMI. */
const PrepaymentWhatIf = ({ loan }: { loan: Loan }) => {
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  const [amount, setAmount] = useState('');
  const [after, setAfter] = useState(loan.emis_paid);
  const value = Number(amount);
  const { data, isError } = useGetPrepayment(
    loan.debt_id,
    value > 0 ? value : null,
    after,
  );

  return (
    <Stack gap={1} mt={2}>
      <Typography variant="subtitle2">
        {t('debts.loans.whatIfTitle')}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
        <TextField
          size="small"
          label={t('debts.loans.prepayAmount')}
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <TextField
          select
          size="small"
          label={t('debts.loans.prepayAfter')}
          value={after}
          onChange={(e) => setAfter(Number(e.target.value))}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value={0}>{t('debts.loans.beforeFirst')}</MenuItem>
          {loan.schedule.map((r) => (
            <MenuItem key={r.n} value={r.n}>
              {t('debts.loans.afterInstallment', {
                n: r.n,
                date: formatDate(r.date),
              })}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      {isError && (
        <Typography variant="body2" color="error">
          {t('common.somethingWentWrongTryAgain')}
        </Typography>
      )}
      {data && value > 0 && (
        <Typography variant="body2">
          {t('debts.loans.whatIfResult', {
            count: data.months_saved,
            interest: formatCurrency.invoke(data.interest_saved),
            date: data.new_end_date ? formatDate(data.new_end_date) : '—',
          })}
        </Typography>
      )}
    </Stack>
  );
};

/** Pick any nearby expense within ±₹1 of the EMI and match it to the installment. */
const LinkInstallmentDialog = (props: {
  loan: Loan;
  row: Installment;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const showError = useShowError();
  const match = useMatchInstallment();
  const { data, isLoading } = useGetInstallmentCandidates(
    props.loan.debt_id,
    props.row.n,
  );
  return (
    <TransactionPickerDialog
      title={t('debts.loans.linkInstallmentTitle', {
        n: props.row.n,
        date: formatDate(props.row.date),
      })}
      help={t('debts.loans.linkInstallmentHelp')}
      candidates={data}
      isLoading={isLoading}
      isPending={match.isPending}
      onPick={(transactionId) =>
        match.mutate(
          { id: props.loan.debt_id, n: props.row.n, transactionId },
          { onSuccess: props.onClose, onError: showError },
        )
      }
      onClose={props.onClose}
    />
  );
};

const ScheduleRow = (props: {
  loan: Loan;
  row: Installment;
  suggestion: LoanMatchSuggestion | undefined;
}) => {
  const { loan, row, suggestion } = props;
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  const showError = useShowError();
  const match = useMatchInstallment();
  const markPaid = useMarkInstallmentPaid();
  const unpay = useUnpayInstallment();
  const busy = match.isPending || markPaid.isPending || unpay.isPending;
  const [linking, setLinking] = useState(false);

  const statusLabel =
    row.status === 'paid'
      ? t(
          row.paid_via === 'manual'
            ? 'debts.loans.paidManual'
            : 'debts.loans.paidMatched',
        )
      : t(`debts.loans.status.${row.status}`);

  return (
    <TableRow>
      <TableCell>{row.n}</TableCell>
      <TableCell>{formatDate(row.date)}</TableCell>
      <TableCell align="right">{formatCurrency.invoke(row.emi)}</TableCell>
      <TableCell align="right">{formatCurrency.invoke(row.interest)}</TableCell>
      <TableCell align="right">
        {formatCurrency.invoke(row.principal)}
      </TableCell>
      <TableCell align="right">{formatCurrency.invoke(row.balance)}</TableCell>
      <TableCell>
        <Chip
          size="small"
          color={statusColor[row.status]}
          label={statusLabel}
        />
      </TableCell>
      <TableCell>
        <Stack direction="row" gap={0.5} flexWrap="wrap">
          {row.status === 'paid' ? (
            <Button
              size="small"
              disabled={busy}
              onClick={() =>
                unpay.mutate(
                  { id: loan.debt_id, n: row.n },
                  { onError: showError },
                )
              }
            >
              {t('debts.loans.unpay')}
            </Button>
          ) : (
            <>
              {suggestion && (
                <Button
                  size="small"
                  disabled={busy}
                  title={`${suggestion.description} · ${formatCurrency.invoke(suggestion.amount)} · ${formatDay(suggestion.date)}`}
                  onClick={() =>
                    match.mutate(
                      {
                        id: loan.debt_id,
                        n: row.n,
                        transactionId: Number(suggestion.transaction_id),
                      },
                      { onError: showError },
                    )
                  }
                >
                  {t('debts.loans.match')}
                </Button>
              )}
              <Button
                size="small"
                disabled={busy}
                onClick={() =>
                  markPaid.mutate(
                    { id: loan.debt_id, n: row.n },
                    { onError: showError },
                  )
                }
              >
                {t('debts.loans.markPaid')}
              </Button>
              <Button
                size="small"
                disabled={busy}
                onClick={() => setLinking(true)}
              >
                {t('debts.loans.linkTransaction')}
              </Button>
            </>
          )}
        </Stack>
        {linking && (
          <LinkInstallmentDialog
            loan={loan}
            row={row}
            onClose={() => setLinking(false)}
          />
        )}
      </TableCell>
    </TableRow>
  );
};

/** Schedule, matching suggestions and the prepayment what-if for one loan. */
const LoanDetail = ({ loan }: { loan: Loan }) => {
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  const { data: suggestions } = useGetLoanMatchSuggestions(
    loan.status === 'settled' ? null : loan.debt_id,
  );
  const byN = new Map((suggestions ?? []).map((s) => [s.n, s]));

  return (
    <Stack mt={2}>
      {suggestions && suggestions.length > 0 && (
        <Alert severity="info" sx={{ mb: 1 }}>
          {t('debts.loans.suggestionsHelp', { count: suggestions.length })}
          <Stack component="ul" sx={{ m: 0, pl: 2 }}>
            {suggestions.map((s) => (
              <li key={s.transaction_id}>
                {t('debts.loans.suggestionRow', {
                  n: s.n,
                  description: s.description,
                  amount: formatCurrency.invoke(s.amount),
                  date: formatDay(s.date),
                })}
              </li>
            ))}
          </Stack>
        </Alert>
      )}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell>
              <TableCell>{t('debts.date')}</TableCell>
              <TableCell align="right">{t('debts.loans.emi')}</TableCell>
              <TableCell align="right">{t('debts.loans.interest')}</TableCell>
              <TableCell align="right">
                {t('debts.loans.principalPart')}
              </TableCell>
              <TableCell align="right">{t('debts.loans.balance')}</TableCell>
              <TableCell>{t('debts.loans.statusTitle')}</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {loan.schedule.map((row) => (
              <ScheduleRow
                key={row.n}
                loan={loan}
                row={row}
                suggestion={byN.get(row.n)}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <PrepaymentWhatIf loan={loan} />
    </Stack>
  );
};

/** Pick the income the loan was paid out into (within 30 days of its start). */
const LinkDisbursementDialog = (props: { loan: Loan; onClose: () => void }) => {
  const { t } = useTranslation();
  const showError = useShowError();
  const link = useLinkDisbursement();
  const { data, isLoading } = useGetDisbursementCandidates(
    props.loan.start_date,
  );
  return (
    <TransactionPickerDialog
      title={t('debts.loans.disbursementTitle', { name: props.loan.lender })}
      help={t('debts.loans.disbursementHelp')}
      candidates={data}
      isLoading={isLoading}
      isPending={link.isPending}
      onPick={(transactionId) =>
        link.mutate(
          { id: props.loan.debt_id, transactionId },
          { onSuccess: props.onClose, onError: showError },
        )
      }
      onClose={props.onClose}
    />
  );
};

const LoanCard = (props: { loan: Loan; onDelete: () => void }) => {
  const { loan } = props;
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  const showError = useShowError();
  const markPast = useMarkPastInstallmentsPaid();
  const unlinkDisbursement = useUnlinkDisbursement();
  const [open, setOpen] = useState(false);
  const [linkingDisbursement, setLinkingDisbursement] = useState(false);
  const today = dayjs().format('YYYY-MM-DD');
  const pastUnpaid = loan.schedule.filter(
    (r) => r.status !== 'paid' && r.date <= today,
  ).length;

  return (
    <DataCard>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        gap={1}
      >
        <Stack gap={0.5}>
          <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
            <Typography variant="h6">{loan.lender}</Typography>
            {loan.status === 'settled' ? (
              <Chip
                size="small"
                color="success"
                label={t('debts.loans.closed')}
              />
            ) : loan.missed_count > 0 ? (
              <Chip
                size="small"
                color="error"
                label={t('debts.loans.missedCount', {
                  count: loan.missed_count,
                })}
              />
            ) : null}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t('debts.loans.terms', {
              emi: formatCurrency.invoke(loan.emi),
              day: loan.emi_day,
              rate: loan.rate,
              principal: formatCurrency.invoke(loan.principal),
            })}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('debts.loans.progress', {
              interest: formatCurrency.invoke(loan.interest_paid),
              count: loan.emis_left,
              date: loan.end_date ? formatDate(loan.end_date) : '—',
            })}
          </Typography>
          {loan.disbursement && (
            <Typography variant="body2" color="text.secondary">
              {t('debts.loans.disbursedInto', {
                description: loan.disbursement.description,
                amount: formatCurrency.invoke(loan.disbursement.amount),
                date: formatDay(loan.disbursement.date),
              })}
            </Typography>
          )}
        </Stack>
        <Stack alignItems={{ xs: 'flex-start', sm: 'flex-end' }} gap={0.5}>
          <Typography variant="h6">
            {formatCurrency.invoke(loan.outstanding_principal)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('debts.loans.outstandingPrincipal')}
          </Typography>
        </Stack>
      </Stack>

      <Stack direction="row" gap={1} mt={1} flexWrap="wrap">
        <Button size="small" onClick={() => setOpen((v) => !v)}>
          {t(open ? 'debts.loans.hideSchedule' : 'debts.loans.showSchedule')}
        </Button>
        {pastUnpaid > 0 && (
          <Button
            size="small"
            disabled={markPast.isPending}
            onClick={() =>
              markPast.mutate(loan.debt_id, { onError: showError })
            }
          >
            {t('debts.loans.markPastPaid', { count: pastUnpaid })}
          </Button>
        )}
        {loan.disbursement ? (
          <Button
            size="small"
            disabled={unlinkDisbursement.isPending}
            onClick={() =>
              unlinkDisbursement.mutate(loan.debt_id, { onError: showError })
            }
          >
            {t('debts.loans.unlinkDisbursement')}
          </Button>
        ) : (
          <Button size="small" onClick={() => setLinkingDisbursement(true)}>
            {t('debts.loans.linkDisbursement')}
          </Button>
        )}
        <Button size="small" color="error" onClick={props.onDelete}>
          {t('common.delete')}
        </Button>
      </Stack>

      {open && <LoanDetail loan={loan} />}
      {linkingDisbursement && (
        <LinkDisbursementDialog
          loan={loan}
          onClose={() => setLinkingDisbursement(false)}
        />
      )}
    </DataCard>
  );
};

const LoansTab = () => {
  const { t } = useTranslation();
  const showError = useShowError();
  const { data, isLoading, isError } = useGetLoans();
  const remove = useDeleteDebt();
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState<Loan | null>(null);

  const sorted = [...(data ?? [])].sort(
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
            <PanelTitle>{t('debts.loans.title')}</PanelTitle>
            <Typography variant="body2" color="text.secondary">
              {t('debts.loans.help')}
            </Typography>
          </Stack>
          <Button variant="contained" onClick={() => setAdding(true)}>
            {t('debts.loans.addLoan')}
          </Button>
        </Stack>
      </DataCard>

      {isError && <Alert severity="error">{t('debts.loadFailed')}</Alert>}
      {isLoading && !data && (
        <Typography color="text.secondary">{t('debts.loading')}</Typography>
      )}
      {data && sorted.length === 0 && (
        <Alert severity="info">{t('debts.loans.empty')}</Alert>
      )}
      {sorted.map((l) => (
        <LoanCard key={l.debt_id} loan={l} onDelete={() => setToDelete(l)} />
      ))}

      {adding && <LoanDialog onClose={() => setAdding(false)} />}
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
        titleText={t('debts.loans.deleteTitle')}
        descriptionText={t('debts.loans.deleteDescription', {
          name: toDelete?.lender ?? '',
        })}
        alert={t('debts.loans.deleteAlert')}
        positiveText={t('common.delete')}
      />
    </Stack>
  );
};

export default LoansTab;
