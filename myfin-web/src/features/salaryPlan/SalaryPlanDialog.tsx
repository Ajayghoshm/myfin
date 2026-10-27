import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  AlertSeverity,
  useSnackbar,
} from '../../providers/SnackbarProvider.tsx';
import { useUserData } from '../../providers/UserProvider.tsx';
import {
  AccountStatus,
  AccountType,
} from '../../services/auth/authServices.ts';
import { useConfirmSalaryPlan } from '../../services/salaryPlan/salaryPlanHooks.ts';
import type {
  BucketName,
  SalaryPlan,
} from '../../services/salaryPlan/salaryPlanServices.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { salaryPlanRoute } from './salaryPlanRoute.ts';

const EDITABLE: BucketName[] = ['fixed', 'yearly', 'emergency', 'savings'];
const TRANSFER: BucketName[] = ['yearly', 'emergency', 'savings'];

const toNumber = (v: string) => {
  const n = Number.parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

type Props = { proposal: SalaryPlan; onClose: () => void };

/** Editable split of one salary. "Free to spend" is whatever the other buckets leave. */
const SalaryPlanDialog = ({ proposal, onClose }: Props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const snackbar = useSnackbar();
  const money = useFormatNumberAsCurrency().invoke;
  const { userAccounts } = useUserData();
  const confirm = useConfirmSalaryPlan();
  const salary = proposal.salary;

  const accounts = useMemo(
    () =>
      (userAccounts ?? []).filter(
        (a) =>
          a.type !== AccountType.Investing && a.status === AccountStatus.Active,
      ),
    [userAccounts],
  );
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      proposal.buckets.map((b) => [b.bucket, String(Math.max(0, b.amount))]),
    ),
  );
  const [accountIds, setAccountIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      proposal.buckets.map((b) => [b.bucket, b.account_to_id ?? '']),
    ),
  );

  if (!salary || !proposal.month) return null;
  const month = proposal.month;
  const others = EDITABLE.reduce((s, b) => s + toNumber(amounts[b] ?? ''), 0);
  const free = Math.round((salary.amount - others) * 100) / 100;

  const submit = () => {
    confirm.mutate(
      {
        month,
        salary_transaction_id: Number(salary.transaction_id),
        buckets: [
          ...EDITABLE.map((b) => ({
            bucket: b,
            amount: toNumber(amounts[b] ?? ''),
            account_to_id:
              TRANSFER.includes(b) && accountIds[b]
                ? Number(accountIds[b])
                : null,
          })),
          {
            bucket: 'free' as const,
            amount: Math.max(0, free),
            account_to_id: null,
          },
        ],
      },
      {
        onSuccess: () => navigate(salaryPlanRoute(month)),
        onError: () =>
          snackbar.showSnackbar(
            t('salaryPlan.confirmFailed'),
            AlertSeverity.ERROR,
          ),
      },
    );
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('salaryPlan.dialogTitle')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" mb={2}>
          {t('salaryPlan.dialogIntro', { amount: money(salary.amount) })}
        </Typography>
        <Stack gap={2} mt={1}>
          {EDITABLE.map((b) => (
            <Stack key={b} direction={{ xs: 'column', sm: 'row' }} gap={1}>
              <TextField
                label={t(`salaryPlan.bucket.${b}`)}
                value={amounts[b] ?? ''}
                onChange={(e) =>
                  setAmounts((prev) => ({ ...prev, [b]: e.target.value }))
                }
                type="number"
                slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
                sx={{ flex: 1 }}
              />
              {TRANSFER.includes(b) && (
                <TextField
                  select
                  label={t('salaryPlan.transferTo')}
                  value={accountIds[b] ?? ''}
                  onChange={(e) =>
                    setAccountIds((prev) => ({ ...prev, [b]: e.target.value }))
                  }
                  sx={{ flex: 1 }}
                >
                  <MenuItem value="">{t('salaryPlan.noAccount')}</MenuItem>
                  {accounts.map((a) => (
                    <MenuItem
                      key={String(a.account_id)}
                      value={String(a.account_id)}
                    >
                      {a.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Stack>
          ))}
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="baseline"
          >
            <Typography variant="h6">{t('salaryPlan.bucket.free')}</Typography>
            <Typography
              variant="h6"
              color={free < 0 ? 'error' : 'text.primary'}
              data-testid="salary-plan-free"
            >
              {money(free)}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {t('salaryPlan.freeNote')}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={confirm.isPending}
        >
          {t('salaryPlan.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SalaryPlanDialog;
