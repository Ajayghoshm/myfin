import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import dayjs from 'dayjs';
import { useState } from 'react';
import Dropzone from 'react-dropzone';
import { useTranslation } from 'react-i18next';
import UploadDropzoneBox from '../../components/UploadDropzoneBox.tsx';
import {
  AlertSeverity,
  useSnackbar,
} from '../../providers/SnackbarProvider.tsx';
import { useUserData } from '../../providers/UserProvider.tsx';
import {
  useGetMonthBackup,
  useImportMonthBackup,
} from '../../services/user/userHooks.ts';
import type { ImportMonthResult } from '../../services/user/userServices.ts';
import { downloadJsonFile } from '../../utils/fileUtils.ts';

interface Props {
  mode: 'export' | 'import';
  isOpen: boolean;
  onClose: () => void;
}

/** Export one month of transactions to a file, or merge such a file back in without touching other data. */
const MonthBackupDialog = ({ mode, isOpen, onClose }: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const snackbar = useSnackbar();
  const { userSessionData } = useUserData();
  const exportRequest = useGetMonthBackup();
  const importRequest = useImportMonthBackup();

  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const [result, setResult] = useState<ImportMonthResult | null>(null);

  const fail = () =>
    snackbar.showSnackbar(
      t('common.somethingWentWrongTryAgain'),
      AlertSeverity.ERROR,
    );

  const onExport = () =>
    exportRequest.mutate(month, {
      onSuccess: (data) => {
        downloadJsonFile(
          data as string,
          `myfin_${userSessionData?.username ?? ''}_${month}.month.json`,
        );
        onClose();
      },
      onError: fail,
    });

  const onFilesUploaded = async (files: File[]) => {
    if (files.length < 1) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await files[0].text());
    } catch {
      snackbar.showSnackbar(
        t('profile.monthBackup.notAMonthFile'),
        AlertSeverity.ERROR,
      );
      return;
    }
    importRequest.mutate(parsed, {
      onSuccess: setResult,
      onError: () =>
        snackbar.showSnackbar(
          t('profile.monthBackup.notAMonthFile'),
          AlertSeverity.ERROR,
        ),
    });
  };

  const busy = exportRequest.isPending || importRequest.isPending;

  return (
    <Dialog
      open={isOpen}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle>
        {t(
          mode === 'export'
            ? 'profile.monthBackup.exportTitle'
            : 'profile.monthBackup.importTitle',
        )}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {mode === 'export' && (
            <>
              <Typography variant="body2" color="text.secondary">
                {t('profile.monthBackup.exportHelp')}
              </Typography>
              <TextField
                type="month"
                size="small"
                label={t('profile.monthBackup.month')}
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </>
          )}
          {mode === 'import' && !result && (
            <>
              <Alert severity="info">
                {t('profile.monthBackup.importHelp')}
              </Alert>
              <Dropzone
                accept={{ 'application/json': ['.json'] }}
                onDrop={(files) => void onFilesUploaded(files)}
                maxFiles={1}
              >
                {({
                  getRootProps,
                  getInputProps,
                  isDragAccept,
                  isDragReject,
                  isFocused,
                }) => (
                  <UploadDropzoneBox
                    {...getRootProps()}
                    theme={theme}
                    isFocused={isFocused}
                    isDragAccept={isDragAccept}
                    isDragReject={isDragReject}
                  >
                    <input {...getInputProps()} />
                    <p>{t('dropZone.uploadText')}</p>
                  </UploadDropzoneBox>
                )}
              </Dropzone>
            </>
          )}
          {result && (
            <Alert severity="success">
              {t('profile.monthBackup.importResult', {
                month: result.month,
                imported: result.imported,
                skipped: result.skipped,
                accounts: result.created.accounts,
                categories: result.created.categories,
                entities: result.created.entities,
                tags: result.created.tags,
              })}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {result ? t('common.close') : t('common.cancel')}
        </Button>
        {mode === 'export' && (
          <Button
            variant="contained"
            disabled={busy || !month}
            onClick={onExport}
          >
            {t('profile.monthBackup.download')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default MonthBackupDialog;
