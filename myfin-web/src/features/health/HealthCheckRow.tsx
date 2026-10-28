import {
  CancelOutlined,
  CheckCircleOutlined,
  RadioButtonUnchecked,
} from '@mui/icons-material';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import type {
  HealthCheck,
  HealthTextParams,
} from '../../services/insights/insightsServices.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';

const StatusIcon = ({ status }: { status: HealthCheck['status'] }) => {
  const { t } = useTranslation();
  const label = t(`health.status.${status}`);
  if (status === 'pass')
    return <CheckCircleOutlined color="success" aria-label={label} />;
  if (status === 'fail')
    return <CancelOutlined color="error" aria-label={label} />;
  return <RadioButtonUnchecked color="disabled" aria-label={label} />;
};

/** One check: status icon, name and figure, the hint, and a link to fix or set it up. */
const HealthCheckRow = ({ check }: { check: HealthCheck }) => {
  const { t } = useTranslation();
  const formatCurrency = useFormatNumberAsCurrency();
  // `amount` params are currency; everything else is shown as given.
  const params = (p: HealthTextParams) =>
    typeof p.amount === 'number'
      ? { ...p, amount: formatCurrency.invoke(p.amount) }
      : p;
  const value = check.value_key
    ? t(`health.values.${check.value_key}`, {
        ...params(check.value_params),
        defaultValue: check.value ?? '',
      })
    : check.value;
  const hint = t(`health.hints.${check.hint_key}`, {
    ...params(check.hint_params),
    defaultValue: check.hint,
  });
  const linkText =
    check.status === 'not_set_up' ? t('health.setUp') : t('health.fix');
  return (
    <Stack direction="row" gap={1.5} alignItems="flex-start" py={1}>
      <StatusIcon status={check.status} />
      <Stack flex={1} minWidth={0}>
        <Typography variant="body1">
          {t(`health.checks.${check.key}`)}
          {value ? (
            <Typography component="span" color="text.secondary">
              {` · ${value}`}
            </Typography>
          ) : null}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {hint}
        </Typography>
      </Stack>
      {check.status !== 'pass' ? (
        <Link
          component={RouterLink}
          to={check.link}
          underline="hover"
          variant="body2"
          sx={{ whiteSpace: 'nowrap' }}
        >
          {linkText}
        </Link>
      ) : null}
    </Stack>
  );
};

export default HealthCheckRow;
