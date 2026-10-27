import { Autocomplete, ToggleButton, ToggleButtonGroup } from '@mui/material';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertSeverity,
  useSnackbar,
} from '../../providers/SnackbarProvider.tsx';
import { useGetAccounts } from '../../services/account/accountHooks.ts';
import { AccountType } from '../../services/auth/authServices.ts';
import { useGetCategories } from '../../services/category/CategoryHooks.tsx';
import {
  useGetFinancialProfile,
  useUpdateFinancialProfile,
} from '../../services/profile/financialProfileHooks.ts';
import type { SavingsTargetMode } from '../../services/profile/financialProfileServices.ts';
import { apiErrorMessage } from '../../utils/apiErrorMessage.ts';

const FinancialProfileForm = () => {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const profileRequest = useGetFinancialProfile();
  const categoriesRequest = useGetCategories();
  const accountsRequest = useGetAccounts();
  const updateRequest = useUpdateFinancialProfile();

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [cutoffDay, setCutoffDay] = useState('25');
  const [targetMode, setTargetMode] = useState<SavingsTargetMode>('amount');
  const [targetValue, setTargetValue] = useState('0');
  const [savingsAccountId, setSavingsAccountId] = useState<string | null>(null);
  const [sinkingAccountId, setSinkingAccountId] = useState<string | null>(null);
  const [emergencyMonths, setEmergencyMonths] = useState('6');
  const [topupPercent, setTopupPercent] = useState('10');

  useEffect(() => {
    if (!profileRequest.data) return;
    setCategoryId(profileRequest.data.salary_category_id);
    setCutoffDay(String(profileRequest.data.salary_cutoff_day));
    setTargetMode(profileRequest.data.savings_target_mode);
    setTargetValue(String(profileRequest.data.savings_target_value));
    setSavingsAccountId(profileRequest.data.savings_target_account_id);
    setSinkingAccountId(profileRequest.data.sinking_fund_account_id);
    setEmergencyMonths(
      String(profileRequest.data.emergency_fund_target_months),
    );
    setTopupPercent(String(profileRequest.data.emergency_topup_percent));
  }, [profileRequest.data]);

  const options = (categoriesRequest.data ?? []).map((cat) => ({
    id: String(cat.category_id),
    label: cat.name,
  }));
  const selected = options.find((o) => o.id === categoryId) ?? null;

  // Investment accounts cannot be earmarked
  const accountOptions = (accountsRequest.data ?? [])
    .filter((a) => a.type !== AccountType.Investing)
    .map((a) => ({ id: String(a.account_id), label: a.name }));
  const savingsAccount =
    accountOptions.find((o) => o.id === savingsAccountId) ?? null;
  const sinkingAccount =
    accountOptions.find((o) => o.id === sinkingAccountId) ?? null;

  const targetNumber = Number(targetValue);
  const isTargetValid =
    targetValue !== '' &&
    Number.isFinite(targetNumber) &&
    targetNumber >= 0 &&
    (targetMode === 'amount' ||
      (Number.isInteger(targetNumber) && targetNumber <= 100));
  const monthsNumber = Number(emergencyMonths);
  const isMonthsValid =
    Number.isInteger(monthsNumber) && monthsNumber >= 1 && monthsNumber <= 24;
  const topupNumber = Number(topupPercent);
  const isTopupValid =
    Number.isInteger(topupNumber) && topupNumber >= 0 && topupNumber <= 100;

  const day = Number(cutoffDay);
  const isDayValid = Number.isInteger(day) && day >= 1 && day <= 28;

  const onSave = () => {
    updateRequest.mutate(
      {
        salary_category_id: categoryId === null ? null : Number(categoryId),
        salary_cutoff_day: day,
        savings_target_mode: targetMode,
        savings_target_value: targetNumber,
        savings_target_account_id:
          savingsAccountId === null ? null : Number(savingsAccountId),
        sinking_fund_account_id:
          sinkingAccountId === null ? null : Number(sinkingAccountId),
        emergency_fund_target_months: monthsNumber,
        emergency_topup_percent: topupNumber,
      },
      {
        onSuccess: () =>
          snackbar.showSnackbar(
            t('profile.financialProfileSaved'),
            AlertSeverity.SUCCESS,
          ),
        onError: (error) =>
          snackbar.showSnackbar(
            apiErrorMessage(error, t('common.somethingWentWrongTryAgain')),
            AlertSeverity.ERROR,
          ),
      },
    );
  };

  return (
    <Grid container spacing={2} size={12}>
      <Grid size={12}>
        <Autocomplete
          id="salary-category"
          value={selected}
          options={options}
          onChange={(_event, value) => setCategoryId(value?.id ?? null)}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          renderInput={(params) => (
            <TextField
              sx={{ mt: 2 }}
              {...params}
              fullWidth
              label={t('profile.salaryCategory')}
              placeholder={t('profile.salaryCategoryNone')}
            />
          )}
        />
      </Grid>
      <Grid size={12}>
        <TextField
          id="salary-cutoff-day"
          fullWidth
          type="number"
          label={t('profile.salaryCutoffDay')}
          helperText={t('profile.salaryCutoffDayHelper')}
          value={cutoffDay}
          error={!isDayValid}
          onChange={(e) => setCutoffDay(e.target.value)}
          slotProps={{ htmlInput: { min: 1, max: 28 } }}
        />
      </Grid>
      <Grid size={12}>
        <ToggleButtonGroup
          exclusive
          size="small"
          color="primary"
          value={targetMode}
          onChange={(_e, value: SavingsTargetMode | null) => {
            if (value === null || value === targetMode) return;
            setTargetMode(value);
            setTargetValue('0');
          }}
        >
          <ToggleButton value="amount">
            {t('profile.savingsTargetAmount')}
          </ToggleButton>
          <ToggleButton value="percent">
            {t('profile.savingsTargetPercent')}
          </ToggleButton>
        </ToggleButtonGroup>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          id="savings-target-value"
          fullWidth
          type="number"
          label={t(
            targetMode === 'amount'
              ? 'profile.savingsTargetValueAmount'
              : 'profile.savingsTargetValuePercent',
          )}
          helperText={t('profile.savingsTargetHelper')}
          value={targetValue}
          error={!isTargetValid}
          onChange={(e) => setTargetValue(e.target.value)}
          slotProps={{
            htmlInput: {
              min: 0,
              max: targetMode === 'percent' ? 100 : undefined,
              step: targetMode === 'percent' ? 1 : 0.01,
            },
          }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Autocomplete
          id="savings-target-account"
          value={savingsAccount}
          options={accountOptions}
          onChange={(_event, value) => setSavingsAccountId(value?.id ?? null)}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          renderInput={(params) => (
            <TextField
              {...params}
              fullWidth
              label={t('profile.savingsTargetAccount')}
              placeholder={t('profile.salaryCategoryNone')}
            />
          )}
        />
      </Grid>
      <Grid size={12}>
        <Autocomplete
          id="sinking-fund-account"
          value={sinkingAccount}
          options={accountOptions}
          onChange={(_event, value) => setSinkingAccountId(value?.id ?? null)}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          renderInput={(params) => (
            <TextField
              {...params}
              fullWidth
              label={t('profile.sinkingFundAccount')}
              helperText={t('profile.sinkingFundAccountHelper')}
              placeholder={t('profile.salaryCategoryNone')}
            />
          )}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          id="emergency-fund-months"
          fullWidth
          type="number"
          label={t('profile.emergencyFundMonths')}
          helperText={t('profile.emergencyFundMonthsHelper')}
          value={emergencyMonths}
          error={!isMonthsValid}
          onChange={(e) => setEmergencyMonths(e.target.value)}
          slotProps={{ htmlInput: { min: 1, max: 24 } }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          id="emergency-topup-percent"
          fullWidth
          type="number"
          label={t('profile.emergencyTopupPercent')}
          helperText={t('profile.emergencyTopupPercentHelper')}
          value={topupPercent}
          error={!isTopupValid}
          onChange={(e) => setTopupPercent(e.target.value)}
          slotProps={{ htmlInput: { min: 0, max: 100 } }}
        />
      </Grid>
      <Grid offset="auto">
        <Button
          variant="contained"
          onClick={onSave}
          disabled={
            !isDayValid ||
            !isTargetValid ||
            !isMonthsValid ||
            !isTopupValid ||
            updateRequest.isPending
          }
        >
          {t('profile.financialProfileSave')}
        </Button>
      </Grid>
    </Grid>
  );
};

export default FinancialProfileForm;
