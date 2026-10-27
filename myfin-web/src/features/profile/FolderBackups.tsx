import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
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
import {
  useCreateFolderBackup,
  useGetFolderBackups,
  useRestoreFolderBackup,
} from '../../services/profile/folderBackupHooks.ts';

const MIN_PASSWORD = 8;

const FolderBackups = () => {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const query = useGetFolderBackups();
  const createBackup = useCreateFolderBackup();
  const restoreBackup = useRestoreFolderBackup();

  // Passwords live only in this component state and are cleared on close.
  const [createOpen, setCreateOpen] = useState(false);
  const [restoreFile, setRestoreFile] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const closeDialogs = () => {
    setCreateOpen(false);
    setRestoreFile(null);
    setPassword('');
    setConfirm('');
  };

  const available = query.data?.available === true;
  const failure = () =>
    snackbar.showSnackbar(
      t('common.somethingWentWrongTryAgain'),
      AlertSeverity.ERROR,
    );

  const onCreate = () => {
    createBackup.mutate(password, {
      onSuccess: () => {
        closeDialogs();
        snackbar.showSnackbar(
          t('common.taskSuccessfullyCompleted'),
          AlertSeverity.SUCCESS,
        );
      },
      onError: failure,
    });
  };

  const onRestore = () => {
    if (!restoreFile) return;
    restoreBackup.mutate(
      { file: restoreFile, password },
      {
        onSuccess: () => {
          closeDialogs();
          snackbar.showSnackbar(
            t('common.taskSuccessfullyCompleted'),
            AlertSeverity.SUCCESS,
          );
        },
        onError: () =>
          snackbar.showSnackbar(
            t('profile.folderBackups.restoreFailed'),
            AlertSeverity.ERROR,
          ),
      },
    );
  };

  const createInvalid =
    password.length < MIN_PASSWORD || password !== confirm;

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {t('profile.folderBackups.description')}
      </Typography>
      {query.data && !available && (
        <Alert severity="info">
          {t('profile.folderBackups.unavailable')}
          {query.data.reason ? `: ${query.data.reason}` : ''}
        </Alert>
      )}
      <div>
        <Button
          variant="contained"
          disabled={!available}
          onClick={() => setCreateOpen(true)}
        >
          {t('profile.folderBackups.backUpNow')}
        </Button>
      </div>
      {available && query.data && query.data.backups.length === 0 && (
        <Typography variant="body2">
          {t('profile.folderBackups.none')}
        </Typography>
      )}
      <List dense>
        {query.data?.backups.map((b) => (
          <ListItem
            key={b.file}
            disableGutters
            secondaryAction={
              <Button size="small" onClick={() => setRestoreFile(b.file)}>
                {t('profile.folderBackups.restore')}
              </Button>
            }
          >
            <ListItemText
              primary={dayjs.unix(b.created_at).format('YYYY-MM-DD HH:mm')}
              secondary={`${b.file} · ${(b.size / 1024).toFixed(0)} KB`}
            />
          </ListItem>
        ))}
      </List>

      <Dialog open={createOpen} onClose={closeDialogs} fullWidth maxWidth="xs">
        <DialogTitle>{t('profile.folderBackups.backUpNow')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="warning">
              {t('profile.folderBackups.passwordWarning')}
            </Alert>
            <TextField
              type="password"
              autoComplete="new-password"
              label={t('profile.folderBackups.password')}
              helperText={t('profile.folderBackups.minLength')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <TextField
              type="password"
              autoComplete="new-password"
              label={t('profile.folderBackups.confirmPassword')}
              value={confirm}
              error={confirm.length > 0 && confirm !== password}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialogs}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={createInvalid || createBackup.isPending}
            onClick={onCreate}
          >
            {t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={restoreFile !== null}
        onClose={closeDialogs}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{t('profile.folderBackups.restore')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="error">
              {t('profile.folderBackups.replacesAllData')}
            </Alert>
            <Typography variant="body2">{restoreFile}</Typography>
            <TextField
              type="password"
              autoComplete="off"
              label={t('profile.folderBackups.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialogs}>{t('common.cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            disabled={password.length < MIN_PASSWORD || restoreBackup.isPending}
            onClick={onRestore}
          >
            {t('profile.folderBackups.restore')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};

export default FolderBackups;
