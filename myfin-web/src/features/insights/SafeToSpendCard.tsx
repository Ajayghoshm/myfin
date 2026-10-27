import { useTheme } from '@mui/material';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DataCard from '../../components/DataCard.tsx';
import { useGetSafeToSpend } from '../../services/insights/insightsHooks.ts';
import { PanelTitle } from '../../theme/styled.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { buildTransactionsLink } from './drillDown.ts';
import FigureLink from './FigureLink.tsx';

const Line = ({
  label,
  value,
  bold,
}: {
  label: ReactNode;
  value: ReactNode;
  bold?: boolean;
}) => (
  <Stack direction="row" justifyContent="space-between" gap={2}>
    <Typography variant="body2" fontWeight={bold ? 700 : undefined}>
      {label}
    </Typography>
    <Typography variant="body2" fontWeight={bold ? 700 : undefined}>
      {value}
    </Typography>
  </Stack>
);

/** What can still be spent freely this month, with a breakdown dialog. */
const SafeToSpendCard = () => {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const formatCurrency = useFormatNumberAsCurrency();
  const { data } = useGetSafeToSpend();
  const [open, setOpen] = useState(false);

  if (!data) return null;

  const money = (n: number) => formatCurrency.invoke(n);
  const negative = data.safe_to_spend < 0;
  const color = negative ? theme.palette.error.main : undefined;
  const [year, month] = data.month.split('-').map(Number);
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
    i18n.language,
    { month: 'long', timeZone: 'UTC' },
  );
  const spentLink = buildTransactionsLink({
    month: data.month,
    type: 'E',
    yearly_cost: 'unlinked',
  });

  return (
    <DataCard>
      <PanelTitle>{t('safeToSpend.title')}</PanelTitle>
      <Typography
        variant="h6"
        sx={{ color, cursor: 'pointer' }}
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen(true);
        }}
      >
        {negative
          ? t('safeToSpend.overSummary', {
              count: data.days_left,
              amount: money(-data.safe_to_spend),
              month: monthName,
              perDay: money(data.per_day),
            })
          : t('safeToSpend.summary', {
              count: data.days_left,
              amount: money(data.safe_to_spend),
              month: monthName,
              perDay: money(data.per_day),
            })}
      </Typography>
      <Button size="small" onClick={() => setOpen(true)} sx={{ mt: 1 }}>
        {t('safeToSpend.details')}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{t('safeToSpend.breakdown')}</DialogTitle>
        <DialogContent>
          <Stack gap={1}>
            <Line
              label={t('safeToSpend.expectedIncome')}
              value={money(data.expected_income)}
            />
            <Typography variant="caption" color="text.secondary">
              {data.typical_income == null
                ? t('safeToSpend.incomeSoFarNoTypical', {
                    amount: money(data.income_so_far),
                  })
                : t('safeToSpend.incomeSoFar', {
                    amount: money(data.income_so_far),
                    typical: money(data.typical_income),
                  })}
            </Typography>
            <Line
              label={t('safeToSpend.spentSoFar')}
              value={
                <FigureLink to={spentLink}>
                  {`− ${money(data.spent_so_far)}`}
                </FigureLink>
              }
            />
            <Line
              label={t('safeToSpend.fixedStillToCome')}
              value={`− ${money(data.fixed_still_to_come)}`}
            />
            {data.has_fixed_categories && data.fixed_lines.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                {t('safeToSpend.noFixedTypical')}
              </Typography>
            )}
            {data.has_fixed_categories ? (
              data.fixed_lines.map((l) => (
                <Typography
                  key={l.category_id}
                  variant="caption"
                  color="text.secondary"
                  sx={{ pl: 2 }}
                >
                  {t('safeToSpend.fixedLine', {
                    name: l.name,
                    typical: money(l.typical),
                    spent: money(l.spent),
                  })}
                </Typography>
              ))
            ) : (
              <Typography variant="caption" color="text.secondary">
                {t('safeToSpend.noFixedCategories')}
              </Typography>
            )}
            {(
              [
                ['savingsTarget', data.savings_deducted, data.savings_target],
                ['yearlySetaside', data.yearly_deducted, data.yearly_setaside],
                [
                  'emergencyTopup',
                  data.emergency_deducted,
                  data.emergency_topup,
                ],
              ] as const
            ).map(([key, deducted, still]) => (
              <Stack key={key}>
                <Line
                  label={t(`safeToSpend.${key}`)}
                  value={`− ${money(deducted)}`}
                />
                {deducted > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    {still > 0
                      ? t('safeToSpend.stillToTransfer', {
                          amount: money(still),
                        })
                      : t('safeToSpend.allTransferred')}
                  </Typography>
                )}
              </Stack>
            ))}
            <Line
              bold
              label={t('safeToSpend.safe')}
              value={<span style={{ color }}>{money(data.safe_to_spend)}</span>}
            />
            <Line
              label={t('safeToSpend.perDay', { count: data.days_left })}
              value={money(data.per_day)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>
            {t('safeToSpend.close')}
          </Button>
        </DialogActions>
      </Dialog>
    </DataCard>
  );
};

export default SafeToSpendCard;
