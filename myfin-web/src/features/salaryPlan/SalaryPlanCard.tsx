import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import DataCard from '../../components/DataCard.tsx';
import { useGetCurrentSalaryPlan } from '../../services/salaryPlan/salaryPlanHooks.ts';
import { PanelTitle } from '../../theme/styled.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { monthLabel } from './monthLabel.ts';
import SalaryPlanDialog from './SalaryPlanDialog.tsx';
import { salaryPlanRoute } from './salaryPlanRoute.ts';

/** Dashboard card: propose a split when salary lands, then link to the plan. Hidden when there is nothing to plan. */
const SalaryPlanCard = () => {
  const { t, i18n } = useTranslation();
  const money = useFormatNumberAsCurrency().invoke;
  const { data } = useGetCurrentSalaryPlan();
  const [open, setOpen] = useState(false);

  if (!data || data.state === 'none' || !data.month) return null;
  // A confirmed plan keeps its link even if its salary transaction was deleted.
  if (data.state === 'proposal' && !data.salary) return null;
  const label = monthLabel(data.month, i18n.language);

  return (
    <DataCard>
      <PanelTitle>{t('salaryPlan.cardTitle')}</PanelTitle>
      {data.state === 'proposal' && data.salary ? (
        <>
          <Typography variant="body2" color="text.secondary" mb={1}>
            {t('salaryPlan.cardProposal', {
              amount: money(data.salary.amount),
              month: label,
            })}
          </Typography>
          <Button variant="contained" onClick={() => setOpen(true)}>
            {t('salaryPlan.planThis')}
          </Button>
          {open && (
            <SalaryPlanDialog proposal={data} onClose={() => setOpen(false)} />
          )}
        </>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" mb={1}>
            {t('salaryPlan.cardConfirmed', { month: label })}
          </Typography>
          <Button component={RouterLink} to={salaryPlanRoute(data.month)}>
            {t('salaryPlan.viewPlan')}
          </Button>
        </>
      )}
    </DataCard>
  );
};

export default SalaryPlanCard;
