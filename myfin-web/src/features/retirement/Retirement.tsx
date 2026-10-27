import { useTheme } from '@mui/material';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Slider from '@mui/material/Slider';
import Typography from '@mui/material/Typography';
import { ResponsiveLine } from '@nivo/line';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import PageHeader from '../../components/PageHeader.tsx';
import { ROUTE_PROFILE } from '../../providers/RoutesProvider.tsx';
import {
  AlertSeverity,
  useSnackbar,
} from '../../providers/SnackbarProvider.tsx';
import {
  useGetRetirement,
  useRetirementWhatIf,
  useSaveRetirementWhatIf,
} from '../../services/retirement/retirementHooks.ts';
import type {
  RetirementOverrides,
  RetirementResult,
} from '../../services/retirement/retirementServices.ts';
import { apiErrorMessage } from '../../utils/apiErrorMessage.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';

const DEBOUNCE_MS = 300;
const MAX_RETIREMENT_AGE = 80;

type SliderKey = keyof RetirementOverrides;

const Retirement = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const snackbar = useSnackbar();
  const formatCurrency = useFormatNumberAsCurrency();
  const baseRequest = useGetRetirement();
  const saveRequest = useSaveRetirementWhatIf();

  // Slider values the user changed; debounced into the what-if request.
  const [changed, setChanged] = useState<RetirementOverrides>({});
  const [debounced, setDebounced] = useState<RetirementOverrides | null>(null);
  useEffect(() => {
    if (Object.keys(changed).length === 0) {
      setDebounced(null);
      return;
    }
    const timer = setTimeout(() => setDebounced(changed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [changed]);
  const whatIfRequest = useRetirementWhatIf(debounced);

  const base = baseRequest.data;
  const result: RetirementResult | undefined =
    debounced !== null && whatIfRequest.data ? whatIfRequest.data : base;

  const chartData = useMemo(
    () =>
      result
        ? [
            {
              id: t('retirement.chartProjection'),
              data: result.projection.map((p) => ({ x: p.age, y: p.corpus })),
            },
            {
              id: t('retirement.chartNeeded'),
              data: result.projection.map((p) => ({ x: p.age, y: p.needed })),
            },
          ]
        : [],
    [result, t],
  );

  if (baseRequest.isError)
    return (
      <Box>
        <PageHeader
          title={t('retirement.title')}
          subtitle={t('retirement.subtitle')}
        />
        <Alert severity="error">{t('retirement.loadFailed')}</Alert>
      </Box>
    );
  if (!base || !result)
    return (
      <Box>
        <PageHeader
          title={t('retirement.title')}
          subtitle={t('retirement.subtitle')}
        />
        <Typography color="text.secondary">
          {t('retirement.loading')}
        </Typography>
      </Box>
    );

  const hasMissing = base.missing.length > 0;
  const age = base.inputs.age ?? 0;
  const values = {
    returnPct: changed.returnPct ?? base.inputs.return_pct,
    inflationPct: changed.inflationPct ?? base.inputs.inflation_pct,
    swrPct: changed.swrPct ?? base.inputs.swr_pct,
    retirementAge: changed.retirementAge ?? base.inputs.retirement_age,
    monthlyInvestment:
      changed.monthlyInvestment ?? base.inputs.monthly_investment,
  };
  const setValue = (key: SliderKey, value: number) =>
    setChanged((prev) => ({ ...prev, [key]: value }));
  const isDirty = Object.keys(changed).length > 0;

  const onSave = () =>
    saveRequest.mutate(changed, {
      onSuccess: () => {
        setChanged({});
        snackbar.showSnackbar(t('retirement.saved'), AlertSeverity.SUCCESS);
      },
      onError: (error) =>
        snackbar.showSnackbar(
          apiErrorMessage(error, t('common.somethingWentWrongTryAgain')),
          AlertSeverity.ERROR,
        ),
    });

  const sliders: Array<{
    key: SliderKey;
    label: string;
    min: number;
    max: number;
    step: number;
    format: (v: number) => string;
  }> = [
    {
      key: 'returnPct',
      label: t('retirement.sliderReturn'),
      min: 0,
      max: 30,
      step: 0.5,
      format: (v) => `${v}%`,
    },
    {
      key: 'inflationPct',
      label: t('retirement.sliderInflation'),
      min: 0,
      max: 20,
      step: 0.5,
      format: (v) => `${v}%`,
    },
    {
      key: 'swrPct',
      label: t('retirement.sliderSwr'),
      min: 1,
      max: 10,
      step: 0.25,
      format: (v) => `${v}%`,
    },
    {
      key: 'retirementAge',
      label: t('retirement.sliderAge'),
      min: Math.min(age + 1, MAX_RETIREMENT_AGE),
      max: MAX_RETIREMENT_AGE,
      step: 1,
      format: (v) => String(v),
    },
    {
      key: 'monthlyInvestment',
      label: t('retirement.sliderInvestment'),
      min: 0,
      max: Math.max(
        100000,
        Math.ceil((base.inputs.monthly_investment * 3) / 1000) * 1000,
      ),
      step: 500,
      format: (v) => formatCurrency.invoke(v),
    },
  ];

  const figure = (label: string, value: string, hint?: string) => (
    <Grid size={{ xs: 12, md: 4 }}>
      <Card variant="outlined" sx={{ height: '100%' }}>
        <CardContent>
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h5">{value}</Typography>
          {hint && (
            <Typography variant="caption" color="text.secondary">
              {hint}
            </Typography>
          )}
        </CardContent>
      </Card>
    </Grid>
  );

  return (
    <Box>
      <PageHeader
        title={t('retirement.title')}
        subtitle={t('retirement.subtitle')}
      />
      {hasMissing ? (
        <Alert
          severity="info"
          action={
            <Button
              color="inherit"
              size="small"
              component={RouterLink}
              to={ROUTE_PROFILE}
            >
              {t('retirement.openSettings')}
            </Button>
          }
        >
          {base.missing.map((m) => t(`retirement.missing.${m}`)).join(' ')}
        </Alert>
      ) : (
        <Grid container spacing={2}>
          {figure(
            t('retirement.corpusNeeded'),
            formatCurrency.invoke(result.corpus_needed?.future ?? 0),
            t('retirement.inTodaysMoney', {
              amount: formatCurrency.invoke(result.corpus_needed?.today ?? 0),
            }),
          )}
          {figure(
            t('retirement.onTrackAge'),
            result.on_track_age === null
              ? t('retirement.notByNinety')
              : t('retirement.ageYears', { age: result.on_track_age }),
            t('retirement.targetAge', { age: result.inputs.retirement_age }),
          )}
          {figure(
            t('retirement.extraMonthly'),
            formatCurrency.invoke(result.extra_monthly_needed ?? 0),
            t('retirement.extraMonthlyHint', {
              amount: formatCurrency.invoke(result.inputs.monthly_investment),
            }),
          )}
          <Grid size={12}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6">
                  {t('retirement.projectionTitle')}
                </Typography>
                <Box sx={{ height: 320 }}>
                  <ResponsiveLine
                    data={chartData}
                    margin={{ top: 20, right: 30, bottom: 50, left: 80 }}
                    xScale={{ type: 'linear', min: 'auto', max: 'auto' }}
                    yScale={{ type: 'linear', min: 0, max: 'auto' }}
                    axisBottom={{
                      legend: t('retirement.chartAge'),
                      legendOffset: 40,
                      legendPosition: 'middle',
                    }}
                    axisLeft={{
                      format: (v) => formatCurrency.invoke(Number(v)),
                    }}
                    colors={[
                      theme.palette.primary.main,
                      theme.palette.warning.main,
                    ]}
                    pointSize={0}
                    useMesh
                    enableSlices="x"
                    yFormat={(v) => formatCurrency.invoke(Number(v))}
                    legends={[
                      {
                        anchor: 'top-left',
                        direction: 'column',
                        itemWidth: 140,
                        itemHeight: 18,
                        translateY: 0,
                        translateX: 10,
                      },
                    ]}
                    theme={theme.nivo}
                  />
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={12}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  {t('retirement.whatIfTitle')}
                </Typography>
                <Grid container spacing={3}>
                  {sliders.map((s) => (
                    <Grid key={s.key} size={{ xs: 12, md: 6 }}>
                      <Typography variant="body2" id={`slider-${s.key}`}>
                        {s.label}: <strong>{s.format(values[s.key])}</strong>
                      </Typography>
                      <Slider
                        aria-labelledby={`slider-${s.key}`}
                        min={s.min}
                        max={s.max}
                        step={s.step}
                        value={Math.min(Math.max(values[s.key], s.min), s.max)}
                        onChange={(_e, v) => setValue(s.key, v as number)}
                      />
                    </Grid>
                  ))}
                </Grid>
                <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                  <Button
                    variant="contained"
                    onClick={onSave}
                    disabled={!isDirty || saveRequest.isPending}
                  >
                    {t('retirement.saveAsSettings')}
                  </Button>
                  <Button disabled={!isDirty} onClick={() => setChanged({})}>
                    {t('retirement.reset')}
                  </Button>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

export default Retirement;
