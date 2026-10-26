import { AccountCircle, KeyboardDoubleArrowRight } from '@mui/icons-material';
import {
  Autocomplete,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  useTheme,
} from '@mui/material';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLoading } from '../../../providers/LoadingProvider.tsx';
import {
  AlertSeverity,
  useSnackbar,
} from '../../../providers/SnackbarProvider.tsx';
import {
  useImportPhonePeCategorize,
  useImportTransactionsStep0,
} from '../../../services/trx/trxHooks.ts';
import { PhonePePreviewResponse } from '../../../services/trx/trxServices.ts';
import { IdLabelPair } from '../AddEditTransactionDialog.tsx';
import { ImportTrxStep1Result } from './ImportTrxStep1.tsx';

export type Props = {
  csv: string;
  preview: PhonePePreviewResponse;
  onNext: (
    result: ImportTrxStep1Result,
    mappings: Array<{ key: string; account_id: bigint }>,
  ) => void;
};

const ImportTrxPhonePeMapping = (props: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const loader = useLoading();
  const snackbar = useSnackbar();
  const importTrxStep0Request = useImportTransactionsStep0();
  const categorizeRequest = useImportPhonePeCategorize();

  // instrument key -> selected account id
  const [selectedAccounts, setSelectedAccounts] = useState<
    Record<string, bigint | null>
  >(() =>
    Object.fromEntries(
      props.preview.instruments.map((instrument) => [
        instrument.key,
        instrument.account_id ?? null,
      ]),
    ),
  );

  const accountOptions: IdLabelPair[] = useMemo(
    () =>
      (importTrxStep0Request.data || []).map((acc) => ({
        id: acc.account_id,
        label: acc.name,
      })),
    [importTrxStep0Request.data],
  );

  // Loading
  useEffect(() => {
    if (importTrxStep0Request.isPending || categorizeRequest.isPending) {
      loader.showLoading();
    } else {
      loader.hideLoading();
    }
  }, [importTrxStep0Request.isPending, categorizeRequest.isPending]);

  // Error
  useEffect(() => {
    if (importTrxStep0Request.isError || categorizeRequest.isError) {
      snackbar.showSnackbar(
        t('common.somethingWentWrongTryAgain'),
        AlertSeverity.ERROR,
      );
    }
  }, [importTrxStep0Request.isError, categorizeRequest.isError]);

  const allMapped = props.preview.instruments.every(
    (instrument) => selectedAccounts[instrument.key] != null,
  );

  const handleContinueButtonClick = async () => {
    if (!allMapped) return;
    const mappings = props.preview.instruments.map((instrument) => ({
      key: instrument.key,
      account_id: selectedAccounts[instrument.key] as bigint,
    }));
    try {
      const result = await categorizeRequest.mutateAsync({
        csv: props.csv,
        mappings,
      });
      props.onNext(
        { ...result, duplicateRows: result.duplicate_rows },
        mappings,
      );
    } catch (_error) {
      /* handled by the error effect */
    }
  };

  if (importTrxStep0Request.isPending || !importTrxStep0Request.data) {
    return null;
  }

  return (
    <Grid container direction="column" spacing={2}>
      <Grid>
        <Typography variant="body1" component="div" sx={{ mt: 2, mb: 2 }}>
          {t('importTransactions.phonePeMappingText')}
        </Typography>
      </Grid>
      <Grid size={12}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>
                  {t('importTransactions.phonePePaymentMethod')}
                </TableCell>
                <TableCell>{t('common.description')}</TableCell>
                <TableCell sx={{ minWidth: 250 }}>
                  {t('common.account')}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {props.preview.instruments.map((instrument) => {
                const selectedId = selectedAccounts[instrument.key];
                const value =
                  accountOptions.find((option) => option.id == selectedId) ??
                  null;
                return (
                  <TableRow key={instrument.key}>
                    <TableCell>{instrument.key}</TableCell>
                    <TableCell>{instrument.sample_description}</TableCell>
                    <TableCell>
                      <Autocomplete
                        id={`account-${instrument.key}`}
                        options={accountOptions}
                        value={value}
                        onChange={(_event, newValue) => {
                          setSelectedAccounts((prev) => ({
                            ...prev,
                            [instrument.key]: newValue?.id ?? null,
                          }));
                        }}
                        isOptionEqualToValue={(option, val) =>
                          option.id === val.id
                        }
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            required
                            size="small"
                            InputProps={{
                              ...params.InputProps,
                              startAdornment: (
                                <InputAdornment position="start">
                                  <AccountCircle />
                                </InputAdornment>
                              ),
                            }}
                            label={t('common.account')}
                          />
                        )}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Grid>
      <Grid sx={{ display: 'flex', justifyContent: 'center' }}>
        <Button
          variant="contained"
          color="primary"
          endIcon={<KeyboardDoubleArrowRight />}
          disabled={!allMapped || categorizeRequest.isPending}
          onClick={() => void handleContinueButtonClick()}
          sx={{ width: 'fit-content', mt: theme.spacing(2) }}
        >
          {t('transactions.continueImport')}
        </Button>
      </Grid>
    </Grid>
  );
};

export default ImportTrxPhonePeMapping;
