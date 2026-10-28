import {
  Delete,
  KeyboardDoubleArrowRight,
  UploadFile,
} from '@mui/icons-material';
import { Box, IconButton, useTheme } from '@mui/material';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertSeverity,
  useSnackbar,
} from '../../../providers/SnackbarProvider.tsx';
import TrxServices, {
  ShareInboxItem,
} from '../../../services/trx/trxServices.ts';
import PairPhoneDialog from './PairPhoneDialog.tsx';

export type Props = {
  onNext: (clipboardText: string) => void;
  onPhonePeFile: (csv: string) => void;
};

const ImportTrxStep0 = (props: Props) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const phonePeInputRef = useRef<HTMLInputElement>(null);
  const [inbox, setInbox] = useState<ShareInboxItem[]>([]);
  const [pairOpen, setPairOpen] = useState(false);

  const loadInbox = useCallback(() => {
    TrxServices.listShareInbox()
      .then((res) => setInbox(res.data))
      .catch(() => setInbox([]));
  }, []);

  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  const useInboxFile = async (item: ShareInboxItem) => {
    try {
      const res = await TrxServices.getShareInboxFile(item.id);
      props.onPhonePeFile(res.data.csv);
    } catch (error) {
      console.error('Failed to read inbox file:', error);
      snackbar.showSnackbar(
        t('common.somethingWentWrongTryAgain'),
        AlertSeverity.ERROR,
      );
    }
  };

  const deleteInboxFile = async (item: ShareInboxItem) => {
    try {
      await TrxServices.deleteShareInboxFile(item.id);
    } catch (error) {
      console.error('Failed to delete inbox file:', error);
    }
    loadInbox();
  };

  const handlePhonePeFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    // Reset so that selecting the same file again still triggers onChange
    event.target.value = '';
    if (!file) return;
    try {
      const csv = await file.text();
      props.onPhonePeFile(csv);
    } catch (error) {
      console.error('Failed to read file:', error);
      snackbar.showSnackbar(
        t('common.somethingWentWrongTryAgain'),
        AlertSeverity.ERROR,
      );
    }
  };

  /**
   * Will try to use the Clipboard API to ask for clipboard permission (if needed) and read the clipboard.
   * Provides fallback method for browsers that do not fully support this API.
   */
  const copyFromClipboard = async () => {
    try {
      // Check if Clipboard API is available
      if (navigator.clipboard && navigator.clipboard.readText) {
        // Check if permissions API is available
        if (navigator.permissions && navigator.permissions.query) {
          try {
            const permissionStatus = await navigator.permissions.query({
              name: 'clipboard-read' as PermissionName,
            });

            if (
              permissionStatus.state === 'granted' ||
              permissionStatus.state === 'prompt'
            ) {
              const text = await navigator.clipboard.readText();
              props.onNext(text);
              return;
            } else {
              snackbar.showSnackbar(
                t('transactions.clipboardPermissionMessage'),
                AlertSeverity.WARNING,
              );
            }
          } catch (permissionError) {
            console.warn(
              'Clipboard permission query not supported',
              permissionError,
            );
            // Proceed to try clipboard reading without explicit permission check
          }
        }

        // If permission API is not available or permission is not granted, try reading anyway
        // This will work in some browsers and fail in others
        try {
          const text = await navigator.clipboard.readText();
          props.onNext(text);
          return;
        } catch (clipboardError) {
          console.warn('Clipboard reading failed', clipboardError);
          // Proceed to fallback method
        }
      }

      // Fallback method for browsers not supporting Clipboard API.
      // In some browsers, the clipboard can only be retrieved by
      // pasting it in a textarea element
      const textArea = document.createElement('textarea');
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      document.execCommand('paste');
      const text = textArea.value;
      document.body.removeChild(textArea);
      props.onNext(text);
    } catch (error) {
      console.error('Failed to copy:', error);
      snackbar.showSnackbar(
        t('common.somethingWentWrongTryAgain'),
        AlertSeverity.ERROR,
      );
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        mt: theme.spacing(8),
      }}
    >
      <Typography variant="h5" component="div" sx={{ mb: theme.spacing(2) }}>
        {t('importTransactions.step0Title')}
      </Typography>
      <Typography
        variant="body1"
        component="div"
        sx={{ textAlign: 'center', pl: theme.spacing(4), pr: theme.spacing(4) }}
      >
        {t('importTransactions.step0Text')}
      </Typography>
      <Button
        variant="contained"
        color="primary"
        endIcon={<KeyboardDoubleArrowRight />}
        onClick={() => copyFromClipboard()}
        sx={{ width: 'fit-content', mt: theme.spacing(2) }}
      >
        {t('transactions.continueImport')}
      </Button>
      <input
        ref={phonePeInputRef}
        type="file"
        accept=".csv"
        hidden
        onChange={(e) => void handlePhonePeFileChange(e)}
      />
      <Button
        variant="outlined"
        color="primary"
        startIcon={<UploadFile />}
        onClick={() => phonePeInputRef.current?.click()}
        sx={{ width: 'fit-content', mt: theme.spacing(2) }}
      >
        {t('importTransactions.uploadPhonePe')}
      </Button>
      <Button
        variant="text"
        onClick={() => setPairOpen(true)}
        sx={{ width: 'fit-content', mt: theme.spacing(1) }}
      >
        {t('importTransactions.pairPhone')}
      </Button>
      <PairPhoneDialog open={pairOpen} onClose={() => setPairOpen(false)} />
      {inbox.length > 0 && (
        <Box sx={{ mt: theme.spacing(3) }}>
          <Typography variant="subtitle1">
            {t('importTransactions.phoneInbox')}
          </Typography>
          {inbox.map((item) => (
            <Box
              key={item.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing(1),
                mt: theme.spacing(1),
              }}
            >
              <Button
                variant="outlined"
                onClick={() => void useInboxFile(item)}
              >
                {item.name} · {new Date(item.received_at).toLocaleString()}
              </Button>
              <IconButton
                aria-label={t('common.delete')}
                onClick={() => void deleteInboxFile(item)}
              >
                <Delete />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default ImportTrxStep0;
