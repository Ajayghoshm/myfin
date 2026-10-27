import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useParams } from 'react-router-dom';
import DataCard from '../../components/DataCard.tsx';
import PageHeader from '../../components/PageHeader.tsx';
import { useUserData } from '../../providers/UserProvider.tsx';
import { useGetSalaryPlan } from '../../services/salaryPlan/salaryPlanHooks.ts';
import { PanelTitle } from '../../theme/styled.ts';
import { useFormatNumberAsCurrency } from '../../utils/textHooks.ts';
import { monthLabel } from './monthLabel.ts';

const TRANSFER = ['yearly', 'emergency', 'savings'];

/** The confirmed plan for one month: per-bucket state, progress and overdue flags. */
const SalaryPlanView = () => {
  const { t, i18n } = useTranslation();
  const { month } = useParams();
  const money = useFormatNumberAsCurrency().invoke;
  const { userAccounts } = useUserData();
  const { data, isError } = useGetSalaryPlan(month);

  const accountName = (id: string | null) =>
    id === null
      ? '-'
      : (userAccounts?.find((a) => String(a.account_id) === id)?.name ?? id);

  if (isError) return <Alert severity="info">{t('salaryPlan.notFound')}</Alert>;
  if (!data || !month) return null;

  const transfers = data.buckets.filter(
    (b) => TRANSFER.includes(b.bucket) && b.state !== 'none',
  );
  const done = transfers.filter((b) => b.state === 'done').length;
  const hasOverdue = transfers.some((b) => b.overdue);

  return (
    <>
      <PageHeader
        title={t('salaryPlan.viewTitle', {
          month: monthLabel(month, i18n.language),
        })}
        subtitle={t('salaryPlan.viewSubtitle')}
      />
      <Stack gap={3}>
        <DataCard>
          <PanelTitle>
            {t('salaryPlan.transfersDone', { done, total: transfers.length })}
          </PanelTitle>
          {hasOverdue && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t('salaryPlan.overdueAlert')}
            </Alert>
          )}
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('salaryPlan.colBucket')}</TableCell>
                <TableCell align="right">{t('salaryPlan.colAmount')}</TableCell>
                <TableCell>{t('salaryPlan.transferTo')}</TableCell>
                <TableCell>{t('salaryPlan.colState')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.buckets.map((b) => (
                <TableRow key={b.bucket}>
                  <TableCell>{t(`salaryPlan.bucket.${b.bucket}`)}</TableCell>
                  <TableCell align="right">
                    <Typography
                      component="span"
                      variant="body2"
                      color={b.amount < 0 ? 'error' : 'text.primary'}
                    >
                      {money(b.amount)}
                    </Typography>
                  </TableCell>
                  <TableCell>{accountName(b.account_to_id)}</TableCell>
                  <TableCell>
                    {TRANSFER.includes(b.bucket) && (
                      <Stack direction="row" gap={1}>
                        <Chip
                          size="small"
                          label={t(`salaryPlan.state.${b.state}`)}
                          color={b.state === 'done' ? 'success' : 'default'}
                          variant={
                            b.state === 'planned' ? 'outlined' : 'filled'
                          }
                        />
                        {b.overdue && (
                          <Chip
                            size="small"
                            color="warning"
                            label={t('salaryPlan.overdue')}
                          />
                        )}
                      </Stack>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            mt={1}
          >
            {t('salaryPlan.freeNote')}
          </Typography>
          <Button
            component={RouterLink}
            to="/transactions?planned=1"
            sx={{ mt: 2 }}
          >
            {t('salaryPlan.seePlanned')}
          </Button>
        </DataCard>
      </Stack>
    </>
  );
};

export default SalaryPlanView;
