import { CheckCircleOutline, CloudDownloadOutlined } from '@mui/icons-material';
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
} from '@mui/material';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertSeverity,
  useSnackbar,
} from '../../providers/SnackbarProvider.tsx';
import { useUserData } from '../../providers/UserProvider.tsx';
import { useLogout } from '../../services/auth/authHooks.ts';
import {
  useClearUserData,
  useGetBackupData,
} from '../../services/user/userHooks.ts';
import { downloadJsonFile } from '../../utils/fileUtils.ts';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Wipes every record of the user. Clearing stays disabled until a backup was
 * downloaded in this dialog and the username was typed to confirm.
 */
const ClearDataDialog = ({ isOpen, onClose }: Props) => {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const logout = useLogout();
  const { userSessionData } = useUserData();
  const username = userSessionData?.username ?? '';

  const backupRequest = useGetBackupData();
  const clearRequest = useClearUserData();

  const [backedUp, setBackedUp] = useState(false);
  const [typedUsername, setTypedUsername] = useState('');

  const busy = backupRequest.isPending || clearRequest.isPending;
  const canClear = backedUp && username !== '' && typedUsername === username;

  const onDownloadBackup = () => {
    backupRequest.mutate(undefined, {
      onSuccess: (data) => {
        downloadJsonFile(
          data,
          `myfin_${username}_${dayjs().format('YYYY_MM_DD_HH_mm_ss')}.json`,
        );
        setBackedUp(true);
      },
      onError: () =>
        snackbar.showSnackbar(
          t('common.somethingWentWrongTryAgain'),
          AlertSeverity.ERROR,
        ),
    });
  };

  const onClear = () => {
    clearRequest.mutate(typedUsername, {
      onSuccess: () => {
        snackbar.showSnackbar(
          t('common.taskSuccessfullyCompleted'),
          AlertSeverity.SUCCESS,
        );
        onClose();
        logout();
      },
      onError: () =>
        snackbar.showSnackbar(
          t('common.somethingWentWrongTryAgain'),
          AlertSeverity.ERROR,
        ),
    });
  };

  return (
    <Dialog
      open={isOpen}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle>{t('profile.clearData.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity="error">{t('profile.clearData.warning')}</Alert>
          <Typography variant="subtitle2">
            {t('profile.clearData.step1')}
          </Typography>
          <div>
            <Button
              variant={backedUp ? 'outlined' : 'contained'}
              startIcon={
                backedUp ? <CheckCircleOutline /> : <CloudDownloadOutlined />
              }
              disabled={busy}
              onClick={onDownloadBackup}
            >
              {backedUp
                ? t('profile.clearData.backupDone')
                : t('profile.clearData.downloadBackup')}
            </Button>
          </div>
          <Typography variant="subtitle2">
            {t('profile.clearData.step2', { username })}
          </Typography>
          <TextField
            size="small"
            autoComplete="off"
            value={typedUsername}
            disabled={!backedUp || busy}
            onChange={(e) => setTypedUsername(e.target.value)}
            placeholder={username}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          color="error"
          variant="contained"
          disabled={!canClear || busy}
          onClick={onClear}
        >
          {t('profile.clearData.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ClearDataDialog;
