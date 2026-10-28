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
import { AccountStatus } from '../../../services/auth/authServices.ts';
import {
  useImportPhonePeCategorize,
  useImportTransactionsStep0,
} from '../../../services/trx/trxHooks.ts';
import { PhonePePreviewResponse } from '../../../services/trx/trxServices.ts';
import AddEditAccountDialog from '../../accounts/AddEditAccountDialog.tsx';
import { IdLabelPair } from '../AddEditTransactionDialog.tsx';
import {
  getImportSelectableAccounts,
  ImportTrxStep1Result,
} from './ImportTrxStep1.tsx';

// placeholder id of the "create new account" entry; never a real account id
const CREATE_ACCOUNT_OPTION_ID = -9999n;

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
      (importTrxStep0Request.data || [])
        // Hide inactive accounts, unless one is already remembered for an instrument
        .filter(
          (acc) =>
            acc.status === AccountStatus.Active ||
            props.preview.instruments.some(
              (instrument) =>
                instrument.account_id != null &&
                String(instrument.account_id) === String(acc.account_id),
            ),
        )
        .map((acc) => ({
          id: acc.account_id,
          label: acc.name,
        })),
    [importTrxStep0Request.data, props.preview.instruments],
  );

  // Instrument whose dropdown asked for a new account, and the account ids that existed then
  const [creatingForKey, setCreatingForKey] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [idsBeforeCreate, setIdsBeforeCreate] = useState<string[]>([]);

  // Once the refreshed account list contains the account just created, select it
  useEffect(() => {
    if (creatingForKey == null || isCreateDialogOpen) return;
    const created = accountOptions.find(
      (option) => !idsBeforeCreate.includes(String(option.id)),
    );
    if (created) {
      setSelectedAccounts((prev) => ({
        ...prev,
        [creatingForKey]: created.id,
      }));
      setCreatingForKey(null);
    }
  }, [accountOptions, creatingForKey, isCreateDialogOpen, idsBeforeCreate]);

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
        {
          ...result,
          duplicateRows: result.duplicate_rows,
          activeAccounts: getImportSelectableAccounts(
            result.accounts,
            result.fillData,
          ),
        },
        mappings,
      );
    } catch (_error) {
      /* handled by the error effect */
    }
  };

  if (importTrxStep0Request.isPending || !importTrxStep0Request.data) {
    return null;
  }

  const closeCreateDialog = () => setIsCreateDialogOpen(false);

  return (
    <Grid container direction="column" spacing={2}>
      {isCreateDialogOpen && (
        <AddEditAccountDialog
          isOpen={isCreateDialogOpen}
          onClose={() => {
            closeCreateDialog();
            setCreatingForKey(null);
          }}
          onPositiveClick={closeCreateDialog}
          onNegativeClick={() => {
            closeCreateDialog();
            setCreatingForKey(null);
          }}
          account={null}
        />
      )}
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
                        options={[
                          ...accountOptions,
                          {
                            id: CREATE_ACCOUNT_OPTION_ID,
                            label: t('importTransactions.createNewAccount'),
                          },
                        ]}
                        value={value}
                        onChange={(_event, newValue) => {
                          if (newValue?.id === CREATE_ACCOUNT_OPTION_ID) {
                            setIdsBeforeCreate(
                              accountOptions.map((option) => String(option.id)),
                            );
                            setCreatingForKey(instrument.key);
                            setIsCreateDialogOpen(true);
                            return;
                          }
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
