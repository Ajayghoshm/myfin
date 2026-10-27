import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
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
  const debtsRequest = useGetDebts();
  const debts = debtsRequest.data?.debts ?? [];
  const totals = debtsRequest.data?.totals ?? { owed_to_you: 0, you_owe: 0 };

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
      {tab === DebtsTab.People && <PeopleTab debts={debts} totals={totals} />}
    </Box>
  );
};

export default Debts;
