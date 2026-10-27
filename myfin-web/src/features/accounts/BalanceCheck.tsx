import {
  Button,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NumericFormat } from 'react-number-format';
import GenericConfirmationDialog from '../../components/GenericConfirmationDialog.tsx';
import PageHeader from '../../components/PageHeader.tsx';
import {
  AlertSeverity,
  useSnackbar,
} from '../../providers/SnackbarProvider.tsx';
import {
  QUERY_KEY_BALANCE_CHECK,
  useGetBalanceCheck,
  useSaveBalanceCheck,
  useWriteOffBalanceGap,
} from '../../services/account/accountHooks.ts';
import { BalanceCheckRow } from '../../services/account/accountServices.ts';
import { AccountType } from '../../services/auth/authServices.ts';
import { TransactionType } from '../../services/trx/trxServices.ts';
import { useUserData } from '../../providers/UserProvider.tsx';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import AddEditTransactionDialog from '../transactions/AddEditTransactionDialog.tsx';

/** Real minus MyFin, both in comparable form, rounded to cents. */
const gapOf = (row: BalanceCheckRow, real: number) =>
  Math.round((real - row.myfin_balance) * 100) / 100;

/**
 * Direction is decided on the raw balance: cards store what is owed as a negative number,
 * so a card whose real owed amount is lower than MyFin's needs income, a bank account an expense.
 */
const missingTransactionType = (row: BalanceCheckRow, gap: number) => {
  const rawChange = row.type === AccountType.Credit ? -gap : gap;
  return rawChange > 0 ? TransactionType.Income : TransactionType.Expense;
};

const BalanceCheck = () => {
  const theme = useTheme();
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const queryClient = useQueryClient();
  const formatCurrency = useFormatNumberAsCurrency();
  const request = useGetBalanceCheck();
  const saveCheck = useSaveBalanceCheck();
  const writeOff = useWriteOffBalanceGap();

  const [inputs, setInputs] = useState<Record<string, number | undefined>>({});
  const [addFor, setAddFor] = useState<BalanceCheckRow | null>(null);
  const [writeOffFor, setWriteOffFor] = useState<BalanceCheckRow | null>(null);

  const { userAccounts } = useUserData();
  const rows = request.data ?? [];
  const failed = () =>
    snackbar.showSnackbar(
      t('common.somethingWentWrongTryAgain'),
      AlertSeverity.ERROR,
    );

  const addGap = addFor ? gapOf(addFor, inputs[addFor.account_id] ?? 0) : 0;
  const writeOffGap = writeOffFor
    ? gapOf(writeOffFor, inputs[writeOffFor.account_id] ?? 0)
    : 0;

  // Stable object: the dialog resets its form whenever this identity changes.
  const prefill = useMemo(() => {
    if (!addFor) return undefined;
    const account = userAccounts?.find(
      (a) => String(a.account_id) === addFor.account_id,
    );
    return {
      type: missingTransactionType(addFor, addGap),
      amount: Math.abs(addGap),
      accountId: account ? account.account_id : BigInt(addFor.account_id),
      accountName: addFor.name,
    };
  }, [addFor, addGap, userAccounts]);

  return (
    <Paper elevation={0} sx={{ p: theme.spacing(2), m: theme.spacing(2) }}>
      {addFor && (
        <AddEditTransactionDialog
          isOpen
          transaction={null}
          prefill={prefill}
          onClose={() => setAddFor(null)}
          onNegativeClick={() => setAddFor(null)}
          onPositiveClick={() => {
            setAddFor(null);
            void queryClient.invalidateQueries({
              queryKey: [QUERY_KEY_BALANCE_CHECK],
            });
          }}
        />
      )}
      {writeOffFor && (
        <GenericConfirmationDialog
          isOpen
          onClose={() => setWriteOffFor(null)}
          onNegativeClick={() => setWriteOffFor(null)}
          onPositiveClick={() => {
            const row = writeOffFor;
            setWriteOffFor(null);
            writeOff.mutate(
              {
                account_id: row.account_id,
                real_balance: inputs[row.account_id] ?? 0,
              },
              {
                onSuccess: () =>
                  snackbar.showSnackbar(
                    t('accounts.writtenOff'),
                    AlertSeverity.SUCCESS,
                  ),
                onError: failed,
              },
            );
          }}
          titleText={t('accounts.writeOffConfirmTitle', {
            name: writeOffFor.name,
          })}
          descriptionText={t('accounts.writeOffConfirmBody', {
            amount: formatCurrency.invoke(Math.abs(writeOffGap)),
          })}
          positiveText={t('accounts.writeOff')}
        />
      )}
      <PageHeader
        title={t('accounts.balanceCheck')}
        subtitle={t('accounts.balanceCheckStrapLine')}
      />
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('accounts.name')}</TableCell>
            <TableCell align="right">{t('accounts.myfinBalance')}</TableCell>
            <TableCell>{t('accounts.realBalance')}</TableCell>
            <TableCell>{t('accounts.balanceCheck')}</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const real = inputs[row.account_id];
            const gap = real === undefined ? null : gapOf(row, real);
            const matches = gap === 0;
            const isCard = row.type === AccountType.Credit;
            return (
              <TableRow key={row.account_id}>
                <TableCell>{row.name}</TableCell>
                <TableCell align="right">
                  {formatCurrency.invoke(row.myfin_balance)}
                </TableCell>
                <TableCell>
                  <NumericFormat
                    customInput={TextField}
                    size="small"
                    label={
                      isCard
                        ? t('accounts.realBalanceOwed')
                        : t('accounts.realBalance')
                    }
                    thousandSeparator
                    decimalScale={2}
                    allowNegative={!isCard}
                    value={real ?? ''}
                    onValueChange={(v) =>
                      setInputs((prev) => ({
                        ...prev,
                        [row.account_id]: v.floatValue,
                      }))
                    }
                  />
                </TableCell>
                <TableCell>
                  {gap !== null && (
                    <Typography
                      variant="body2"
                      color={matches ? 'success.main' : 'warning.main'}
                    >
                      {matches
                        ? t('accounts.gapMatches')
                        : t(
                            gap < 0
                              ? 'accounts.gapMyfinHigher'
                              : 'accounts.gapMyfinLower',
                            { amount: formatCurrency.invoke(Math.abs(gap)) },
                          )}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Stack direction="row" gap={1} flexWrap="wrap">
                    <Button
                      size="small"
                      variant="contained"
                      disabled={gap === null || saveCheck.isPending}
                      onClick={() =>
                        saveCheck.mutate(
                          {
                            account_id: row.account_id,
                            real_balance: real ?? 0,
                          },
                          {
                            onSuccess: () =>
                              snackbar.showSnackbar(
                                t('accounts.checkSaved'),
                                AlertSeverity.SUCCESS,
                              ),
                            onError: failed,
                          },
                        )
                      }
                    >
                      {t('accounts.saveCheck')}
                    </Button>
                    {gap !== null && !matches && (
                      <>
                        <Button size="small" onClick={() => setAddFor(row)}>
                          {t('accounts.addMissingTransaction')}
                        </Button>
                        <Button
                          size="small"
                          color="warning"
                          disabled={writeOff.isPending}
                          onClick={() => setWriteOffFor(row)}
                        >
                          {t('accounts.writeOff')}
                        </Button>
                      </>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Paper>
  );
};

export default BalanceCheck;
