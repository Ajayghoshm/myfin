import { Autocomplete } from '@mui/material';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertSeverity, useSnackbar } from '../../providers/SnackbarProvider.tsx';
import { useGetCategories } from '../../services/category/CategoryHooks.tsx';
import {
  useGetFinancialProfile,
  useUpdateFinancialProfile,
} from '../../services/profile/financialProfileHooks.ts';

const FinancialProfileForm = () => {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const profileRequest = useGetFinancialProfile();
  const categoriesRequest = useGetCategories();
  const updateRequest = useUpdateFinancialProfile();

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [cutoffDay, setCutoffDay] = useState('25');

  useEffect(() => {
    if (!profileRequest.data) return;
    setCategoryId(profileRequest.data.salary_category_id);
    setCutoffDay(String(profileRequest.data.salary_cutoff_day));
  }, [profileRequest.data]);

  const options = (categoriesRequest.data ?? []).map((cat) => ({
    id: String(cat.category_id),
    label: cat.name,
  }));
  const selected = options.find((o) => o.id === categoryId) ?? null;

  const day = Number(cutoffDay);
  const isDayValid = Number.isInteger(day) && day >= 1 && day <= 28;

  const onSave = () => {
    updateRequest.mutate(
      {
        salary_category_id: categoryId === null ? null : Number(categoryId),
        salary_cutoff_day: day,
      },
      {
        onSuccess: () =>
          snackbar.showSnackbar(t('profile.financialProfileSaved'), AlertSeverity.SUCCESS),
        onError: () =>
          snackbar.showSnackbar(t('common.somethingWentWrongTryAgain'), AlertSeverity.ERROR),
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
      <Grid offset="auto">
        <Button
          variant="contained"
          onClick={onSave}
          disabled={!isDayValid || updateRequest.isPending}
        >
          {t('profile.financialProfileSave')}
        </Button>
      </Grid>
    </Grid>
  );
};

export default FinancialProfileForm;
