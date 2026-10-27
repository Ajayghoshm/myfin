import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertSeverity,
  useSnackbar,
} from '../../providers/SnackbarProvider.tsx';
import {
  useCreateLegacyEntry,
  useUpdateLegacyEntry,
} from '../../services/legacy/legacyHooks.ts';
import type {
  LegacyData,
  LegacyEntry,
  LegacyKind,
} from '../../services/legacy/legacyServices.ts';
import { apiErrorMessage } from '../../utils/apiErrorMessage.ts';

export const LEGACY_FIELDS: Record<LegacyKind, string[]> = {
  account: ['bank_branch', 'nominee', 'documents_location'],
  policy: [
    'insurer',
    'policy_number',
    'sum_assured',
    'nominee',
    'claim_helpline',
    'documents_location',
  ],
  contact: ['role', 'name', 'phone', 'email'],
  instruction: ['text'],
};

type Props = {
  kind: LegacyKind;
  onClose: () => void;
  entry?: LegacyEntry;
  accountId?: string;
  /** Initial values for a new entry (e.g. a suggested insurer). */
  initial?: LegacyData;
};

const LegacyEntryDialog = ({
  kind,
  onClose,
  entry,
  accountId,
  initial,
}: Props) => {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const create = useCreateLegacyEntry();
  const update = useUpdateLegacyEntry();
  const fields = LEGACY_FIELDS[kind];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => [f, String((entry?.data ?? initial ?? {})[f] ?? '')]),
    ),
  );

  const onError = (error: unknown) =>
    snackbar.showSnackbar(
      apiErrorMessage(error, t('common.somethingWentWrongTryAgain')),
      AlertSeverity.ERROR,
    );

  const handleSave = () => {
    const data: LegacyData = {};
    for (const f of fields) {
      const v = values[f].trim();
      if (f === 'sum_assured') data[f] = v === '' ? null : Number(v);
      else data[f] = v;
    }
    if (entry) {
      update.mutate(
        { id: entry.entry_id, data },
        { onSuccess: onClose, onError },
      );
    } else {
      create.mutate(
        { kind, account_id: accountId ?? null, data },
        { onSuccess: onClose, onError },
      );
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t(`profile.legacy.kind.${kind}`)}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {fields.map((f) => (
            <TextField
              key={f}
              label={t(`profile.legacy.field.${f}`)}
              value={values[f]}
              type={f === 'sum_assured' ? 'number' : 'text'}
              multiline={f === 'text'}
              minRows={f === 'text' ? 4 : undefined}
              slotProps={{
                htmlInput: { maxLength: f === 'text' ? 5000 : 255 },
              }}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [f]: e.target.value }))
              }
            />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={create.isPending || update.isPending}
        >
          {t('profile.legacy.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default LegacyEntryDialog;
