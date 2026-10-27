import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader.tsx';
import { useGetDebts } from '../../services/debts/debtHooks.ts';
import PeopleTab from './PeopleTab.tsx';

export enum DebtsTab {
  People = 0,
}

const Debts = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DebtsTab>(DebtsTab.People);
  const { data, isLoading, isError } = useGetDebts();

  return (
    <Box>
      <PageHeader title={t('debts.title')} subtitle={t('debts.subtitle')} />
      <Tabs
        value={tab}
        onChange={(_, value: DebtsTab) => setTab(value)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2 }}
      >
        <Tab label={t('debts.tabPeople')} value={DebtsTab.People} />
      </Tabs>
      {isError && <Alert severity="error">{t('debts.loadFailed')}</Alert>}
      {isLoading && !data && (
        <Typography color="text.secondary">{t('debts.loading')}</Typography>
      )}
      {data && tab === DebtsTab.People && (
        <PeopleTab debts={data.debts} totals={data.totals} />
      )}
    </Box>
  );
};

export default Debts;
