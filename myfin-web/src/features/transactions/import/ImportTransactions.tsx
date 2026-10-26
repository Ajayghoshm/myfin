import { Step, StepButton, Stepper, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import Box from '@mui/material/Box';
import PageHeader from '../../../components/PageHeader.tsx';
import Paper from '@mui/material/Paper';
import ImportTrxStep0 from './ImportTrxStep0.tsx';
import ImportTrxStep1, {
  getImportSelectableAccounts,
  ImportTrxStep1Result,
} from './ImportTrxStep1.tsx';
import ImportTrxStep2, { ImportTrxStep2Result } from './ImportTrxStep2.tsx';
import ImportTrxStep3 from './ImportTrxStep3.tsx';
import ImportTrxPhonePeMapping from './ImportTrxPhonePeMapping.tsx';
import {
  useImportPhonePeCategorize,
  useImportPhonePePreview,
} from '../../../services/trx/trxHooks.ts';
import { PhonePePreviewResponse } from '../../../services/trx/trxServices.ts';
import { useLoading } from '../../../providers/LoadingProvider.tsx';
import {
  AlertSeverity,
  useSnackbar,
} from '../../../providers/SnackbarProvider.tsx';
import { AxiosError } from 'axios';

const ImportTransactions = () => {
  const theme = useTheme();
  const { t } = useTranslation();
  const loader = useLoading();
  const snackbar = useSnackbar();
  const phonePePreviewRequest = useImportPhonePePreview();
  const phonePeCategorizeRequest = useImportPhonePeCategorize();

  const [flow, setFlow] = useState<'paste' | 'phonepe'>('paste');
  const [phonePeCsv, setPhonePeCsv] = useState('');
  const [phonePePreview, setPhonePePreview] =
    useState<PhonePePreviewResponse | null>(null);

  const steps =
    flow === 'phonepe'
      ? [
          t('importTransactions.step0Label'),
          t('importTransactions.phonePeMappingLabel'),
          t('importTransactions.step2Label'),
          t('importTransactions.step3Label'),
        ]
      : [
          t('importTransactions.step0Label'),
          t('importTransactions.step1Label'),
          t('importTransactions.step2Label'),
          t('importTransactions.step3Label'),
        ];

  const [currentStep, setCurrentStep] = useState(0);
  const [completed, _setCompleted] = useState<{
    [k: number]: boolean;
  }>({});
  const [clipboardText, setClipboardText] = useState('');
  const [step1Result, setStep1Result] = useState<ImportTrxStep1Result | null>(
    null,
  );
  const [step2Result, setStep2Result] = useState<ImportTrxStep2Result | null>(
    null,
  );
  const handlePhonePeFile = async (csv: string) => {
    let preview: PhonePePreviewResponse;
    loader.showLoading();
    try {
      preview = await phonePePreviewRequest.mutateAsync(csv);
    } catch (error) {
      loader.hideLoading();
      const response = (error as AxiosError<{ message?: string }>)?.response;
      if (response?.status === 400) {
        // The API's APIError responses carry { message, rationale }; show the parser's
        // "line N" detail after the generic text.
        const detail = response.data?.message;
        snackbar.showSnackbar(
          detail
            ? `${t('importTransactions.invalidPhonePeFile')} ${detail}`
            : t('importTransactions.invalidPhonePeFile'),
          AlertSeverity.ERROR,
        );
      } else if (response?.status === 413) {
        snackbar.showSnackbar(
          t('importTransactions.phonePeFileTooLarge'),
          AlertSeverity.ERROR,
        );
      } else {
        snackbar.showSnackbar(
          t('common.somethingWentWrongTryAgain'),
          AlertSeverity.ERROR,
        );
      }
      return;
    }

    if (preview.new_rows === 0) {
      loader.hideLoading();
      snackbar.showSnackbar(
        t('importTransactions.noNewTransactions'),
        AlertSeverity.INFO,
      );
      return;
    }

    setFlow('phonepe');
    setPhonePeCsv(csv);
    setPhonePePreview(preview);
    setStep1Result(null);

    const allMapped = preview.instruments.every(
      (instrument) => instrument.account_id != null,
    );
    if (!allMapped) {
      loader.hideLoading();
      setCurrentStep(1);
      return;
    }

    try {
      const result = await phonePeCategorizeRequest.mutateAsync({
        csv,
        mappings: preview.instruments.map((instrument) => ({
          key: instrument.key,
          account_id: instrument.account_id as bigint,
        })),
      });
      loader.hideLoading();
      setStep1Result({
        ...result,
        duplicateRows: result.duplicate_rows,
        activeAccounts: getImportSelectableAccounts(
          result.accounts,
          result.fillData,
        ),
      });
      setCurrentStep(2);
    } catch (_error) {
      loader.hideLoading();
      snackbar.showSnackbar(
        t('common.somethingWentWrongTryAgain'),
        AlertSeverity.ERROR,
      );
      // Let the user review/fix the mappings and retry from there
      setCurrentStep(1);
    }
  };

  const isStepClickable = (index: number) =>
    flow === 'phonepe' &&
    index === 1 &&
    phonePePreview != null &&
    currentStep > 1 &&
    currentStep < 3;

  const renderStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <ImportTrxStep0
            onNext={(clipboardText: string) => {
              setFlow('paste');
              setClipboardText(clipboardText);
              setCurrentStep(1);
            }}
            onPhonePeFile={(csv: string) => void handlePhonePeFile(csv)}
          />
        );
      case 1:
        if (flow === 'phonepe') {
          if (!phonePePreview) return null;
          return (
            <ImportTrxPhonePeMapping
              csv={phonePeCsv}
              preview={phonePePreview}
              onNext={(result, mappings) => {
                // Keep the user's choices so going back to this step shows them again
                const chosen = new Map(
                  mappings.map((mapping) => [mapping.key, mapping.account_id]),
                );
                setPhonePePreview({
                  ...phonePePreview,
                  instruments: phonePePreview.instruments.map((instrument) => ({
                    ...instrument,
                    account_id:
                      chosen.get(instrument.key) ?? instrument.account_id,
                  })),
                });
                setStep1Result(result);
                setCurrentStep(2);
              }}
            />
          );
        }
        return (
          <ImportTrxStep1
            clipboardText={clipboardText}
            onNext={(result) => {
              setStep1Result(result);
              setCurrentStep(2);
            }}
          />
        );
      case 2:
        if (step1Result) {
          return (
            <ImportTrxStep2
              data={step1Result}
              onNext={(result) => {
                setStep2Result({
                  nrOfTrxImported: result.nrOfTrxImported,
                  accountName: result.accountName,
                });
                setCurrentStep(3);
              }}
            />
          );
        }
        break;
      case 3:
        return (
          <ImportTrxStep3
            nrOfTrxImported={step2Result?.nrOfTrxImported || 0}
            accountName={step2Result?.accountName || ''}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Paper elevation={0} sx={{ p: theme.spacing(2), m: theme.spacing(2) }}>
      <Box display="flex" justifyContent="space-between" flexDirection="column">
        <PageHeader
          title={t('importTransactions.importTransactions')}
          subtitle={t('importTransactions.strapLine')}
        />
      </Box>
      <Box sx={{ mt: theme.spacing(0), mb: theme.spacing(2) }}>
        <Stepper activeStep={currentStep}>
          {steps.map((label, index) => (
            <Step key={label} completed={completed[index]}>
              <StepButton
                color="inherit"
                onClick={() => {
                  if (isStepClickable(index)) setCurrentStep(index);
                }}
              >
                {label}
              </StepButton>
            </Step>
          ))}
        </Stepper>
      </Box>

      <Box sx={{ mt: theme.spacing(0), mb: theme.spacing(2) }}>
        {renderStepContent(currentStep)}
      </Box>
    </Paper>
  );
};

export default ImportTransactions;
