import {
  Autocomplete,
  Divider,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
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
import { isEarmarkableAccountType } from '../../services/auth/authServices.ts';
import { useGetCategories } from '../../services/category/CategoryHooks.tsx';
import { useGetAssets } from '../../services/invest/investHooks.ts';
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
  const assetsRequest = useGetAssets();
  const updateRequest = useUpdateFinancialProfile();

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [cutoffDay, setCutoffDay] = useState('25');
  const [targetMode, setTargetMode] = useState<SavingsTargetMode>('amount');
  const [targetValue, setTargetValue] = useState('0');
  const [savingsAccountId, setSavingsAccountId] = useState<string | null>(null);
  const [sinkingAccountId, setSinkingAccountId] = useState<string | null>(null);
  const [emergencyMonths, setEmergencyMonths] = useState('6');
  const [topupPercent, setTopupPercent] = useState('10');
  const [smallSpendCutoff, setSmallSpendCutoff] = useState('200');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [retirementAge, setRetirementAge] = useState('60');
  const [returnPct, setReturnPct] = useState('10');
  const [inflationPct, setInflationPct] = useState('6');
  const [swrPct, setSwrPct] = useState('3.5');
  const [spendingBasis, setSpendingBasis] = useState<'all' | 'fixed'>('all');
  const [familyMonthly, setFamilyMonthly] = useState('0');
  const [familyYears, setFamilyYears] = useState('0');
  const [retirementAccountIds, setRetirementAccountIds] = useState<string[]>(
    [],
  );
  const [retirementAssetIds, setRetirementAssetIds] = useState<string[]>([]);

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
    setSmallSpendCutoff(String(profileRequest.data.small_spend_cutoff));
    setDateOfBirth(profileRequest.data.date_of_birth ?? '');
    setRetirementAge(String(profileRequest.data.retirement_age));
    setReturnPct(String(profileRequest.data.expected_return_pct));
    setInflationPct(String(profileRequest.data.inflation_pct));
    setSwrPct(String(profileRequest.data.swr_pct));
    setSpendingBasis(profileRequest.data.retirement_spending_basis);
    setFamilyMonthly(String(profileRequest.data.family_support_monthly));
    setFamilyYears(String(profileRequest.data.family_support_years));
    setRetirementAccountIds(profileRequest.data.retirement_account_ids);
    setRetirementAssetIds(profileRequest.data.retirement_asset_ids);
  }, [profileRequest.data]);

  const options = (categoriesRequest.data ?? []).map((cat) => ({
    id: String(cat.category_id),
    label: cat.name,
  }));
  const selected = options.find((o) => o.id === categoryId) ?? null;

  // Investment, card and loan accounts cannot be earmarked
  const accountOptions = (accountsRequest.data ?? [])
    .filter((a) => isEarmarkableAccountType(a.type))
    .map((a) => ({ id: String(a.account_id), label: a.name }));
  const savingsAccount =
    accountOptions.find((o) => o.id === savingsAccountId) ?? null;
  // A retirement-ticked account cannot also be the sinking fund (it may be the savings target)
  const sinkingOptions = accountOptions.filter(
    (o) => !retirementAccountIds.includes(o.id),
  );
  const sinkingAccount =
    sinkingOptions.find((o) => o.id === sinkingAccountId) ?? null;

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

  const smallSpendNumber = Number(smallSpendCutoff);
  const isSmallSpendValid =
    smallSpendCutoff !== '' &&
    Number.isFinite(smallSpendNumber) &&
    smallSpendNumber > 0 &&
    smallSpendNumber <= 100000;

  const inRange = (v: string, min: number, max: number) =>
    v !== '' &&
    Number.isFinite(Number(v)) &&
    Number(v) >= min &&
    Number(v) <= max;
  // A real calendar date, not in the future (local today, as YYYY-MM-DD)
  const todayIso = new Date().toLocaleDateString('en-CA');
  const isRealDate = (v: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const [y, m, d] = v.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  };
  const isDobValid =
    dateOfBirth === '' || (isRealDate(dateOfBirth) && dateOfBirth <= todayIso);
  const isRetAgeValid =
    inRange(retirementAge, 1, 80) && Number.isInteger(Number(retirementAge));
  const isReturnValid = inRange(returnPct, 0, 30);
  const isInflationValid = inRange(inflationPct, 0, 20);
  const isSwrValid = inRange(swrPct, 1, 10);
  const isFamilyMonthlyValid = inRange(familyMonthly, 0, 10000000);
  const isFamilyYearsValid =
    inRange(familyYears, 0, 60) && Number.isInteger(Number(familyYears));
  const isRetirementValid =
    isDobValid &&
    isRetAgeValid &&
    isReturnValid &&
    isInflationValid &&
    isSwrValid &&
    isFamilyMonthlyValid &&
    isFamilyYearsValid;

  // Retirement can overlap the savings target but not emergency or sinking accounts
  const retirementAccountOptions = (accountsRequest.data ?? [])
    .filter(
      (a) =>
        isEarmarkableAccountType(a.type) &&
        !a.is_emergency_fund &&
        String(a.account_id) !== sinkingAccountId,
    )
    .map((a) => ({ id: String(a.account_id), label: a.name }));
  const retirementAssetOptions = (assetsRequest.data ?? []).map((a) => ({
    id: String(a.asset_id),
    label: a.name,
  }));

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
        small_spend_cutoff: smallSpendNumber,
        date_of_birth: dateOfBirth === '' ? null : dateOfBirth,
        retirement_age: Number(retirementAge),
        expected_return_pct: Number(returnPct),
        inflation_pct: Number(inflationPct),
        swr_pct: Number(swrPct),
        retirement_spending_basis: spendingBasis,
        family_support_monthly: Number(familyMonthly),
        family_support_years: Number(familyYears),
        retirement_account_ids: retirementAccountIds.map(Number),
        retirement_asset_ids: retirementAssetIds.map(Number),
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
          options={sinkingOptions}
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
      <Grid size={12}>
        <TextField
          id="small-spend-cutoff"
          fullWidth
          type="number"
          label={t('profile.smallSpendCutoff')}
          helperText={t('profile.smallSpendCutoffHelper')}
          value={smallSpendCutoff}
          error={!isSmallSpendValid}
          onChange={(e) => setSmallSpendCutoff(e.target.value)}
          slotProps={{ htmlInput: { min: 0.01, max: 100000, step: 0.01 } }}
        />
      </Grid>
      <Grid size={12}>
        <Divider textAlign="left">{t('profile.retirementSection')}</Divider>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          id="date-of-birth"
          fullWidth
          type="date"
          label={t('profile.dateOfBirth')}
          helperText={t('profile.dateOfBirthHelper')}
          value={dateOfBirth}
          error={!isDobValid}
          onChange={(e) => setDateOfBirth(e.target.value)}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: { max: todayIso },
          }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          id="retirement-age"
          fullWidth
          type="number"
          label={t('profile.retirementAge')}
          value={retirementAge}
          error={!isRetAgeValid}
          onChange={(e) => setRetirementAge(e.target.value)}
          slotProps={{ htmlInput: { min: 1, max: 80 } }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 4 }}>
        <TextField
          id="expected-return-pct"
          fullWidth
          type="number"
          label={t('profile.expectedReturnPct')}
          value={returnPct}
          error={!isReturnValid}
          onChange={(e) => setReturnPct(e.target.value)}
          slotProps={{ htmlInput: { min: 0, max: 30, step: 0.1 } }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 4 }}>
        <TextField
          id="inflation-pct"
          fullWidth
          type="number"
          label={t('profile.inflationPct')}
          value={inflationPct}
          error={!isInflationValid}
          onChange={(e) => setInflationPct(e.target.value)}
          slotProps={{ htmlInput: { min: 0, max: 20, step: 0.1 } }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 4 }}>
        <TextField
          id="swr-pct"
          fullWidth
          type="number"
          label={t('profile.swrPct')}
          value={swrPct}
          error={!isSwrValid}
          onChange={(e) => setSwrPct(e.target.value)}
          slotProps={{ htmlInput: { min: 1, max: 10, step: 0.05 } }}
        />
      </Grid>
      <Grid size={12}>
        <ToggleButtonGroup
          exclusive
          size="small"
          color="primary"
          value={spendingBasis}
          aria-label={t('profile.retirementSpendingBasis')}
          onChange={(_e, value: 'all' | 'fixed' | null) => {
            if (value !== null) setSpendingBasis(value);
          }}
        >
          <ToggleButton value="all">{t('profile.basisAll')}</ToggleButton>
          <ToggleButton value="fixed">{t('profile.basisFixed')}</ToggleButton>
        </ToggleButtonGroup>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          id="family-support-monthly"
          fullWidth
          type="number"
          label={t('profile.familySupportMonthly')}
          value={familyMonthly}
          error={!isFamilyMonthlyValid}
          onChange={(e) => setFamilyMonthly(e.target.value)}
          slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          id="family-support-years"
          fullWidth
          type="number"
          label={t('profile.familySupportYears')}
          value={familyYears}
          error={!isFamilyYearsValid}
          onChange={(e) => setFamilyYears(e.target.value)}
          slotProps={{ htmlInput: { min: 0, max: 60 } }}
        />
      </Grid>
      <Grid size={12}>
        <Autocomplete
          multiple
          id="retirement-accounts"
          value={retirementAccountOptions.filter((o) =>
            retirementAccountIds.includes(o.id),
          )}
          options={retirementAccountOptions}
          onChange={(_event, value) =>
            setRetirementAccountIds(value.map((v) => v.id))
          }
          isOptionEqualToValue={(option, value) => option.id === value.id}
          renderInput={(params) => (
            <TextField
              {...params}
              fullWidth
              label={t('profile.retirementAccounts')}
              helperText={t('profile.retirementCorpusHelper')}
            />
          )}
        />
      </Grid>
      <Grid size={12}>
        <Autocomplete
          multiple
          id="retirement-assets"
          value={retirementAssetOptions.filter((o) =>
            retirementAssetIds.includes(o.id),
          )}
          options={retirementAssetOptions}
          onChange={(_event, value) =>
            setRetirementAssetIds(value.map((v) => v.id))
          }
          isOptionEqualToValue={(option, value) => option.id === value.id}
          renderInput={(params) => (
            <TextField
              {...params}
              fullWidth
              label={t('profile.retirementAssets')}
            />
          )}
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
            !isSmallSpendValid ||
            !isRetirementValid ||
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
