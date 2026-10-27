import { axios } from '../../data/axios.ts';

export type InsightsRates = {
  income: number;
  spending: number;
  savings: number;
  savings_rate: number | null;
};

export type CostSplit = { fixed: number; flexible: number; unsorted: number };

export type PayeeKind = 'person' | 'merchant';

export type MonthInsights = {
  month: { year: number; month: number };
  range: { from: number; to: number };
  summary: InsightsRates;
  typical: InsightsRates | null;
  by_category: Array<{
    category_id: string | null;
    name: string | null;
    amount: number;
  }>;
  merchants: {
    top: Array<{
      payee_key: string;
      amount: number;
      count: number;
      average: number;
    }>;
    other_amount: number;
  };
  people: Array<{
    payee_key: string;
    sent: number;
    received: number;
    net: number;
    source: 'guess' | 'user';
  }>;
  biggest_changes: Array<{
    kind: 'category' | 'merchant';
    key: string;
    label: string;
    amount: number;
    typical: number;
    change_pct: number | null;
  }>;
  payment_mix: Array<{ account_id: string; name: string; amount: number }>;
  cost_split: CostSplit;
  typical_cost_split: CostSplit | null;
  trend: Array<{
    year: number;
    month: number;
    income: number;
    spending: number;
    fixed: number;
    flexible: number;
    unsorted: number;
    savings_rate: number | null;
  }>;
  one_offs: Array<{
    transaction_id: string;
    payee_key: string;
    amount: number;
    date_timestamp: number;
  }>;
};

export type EmergencyFund = {
  fund: number;
  monthly_fixed: number | null;
  months_covered: number | null;
  target_months: number;
  more_needed: number;
  status: 'red' | 'amber' | 'green' | 'no_accounts' | 'no_fixed';
  accounts: Array<{ account_id: string; name: string; balance: number }>;
};

const getEmergencyFund = () =>
  axios.get<EmergencyFund>('/insights/emergency-fund');

const getMonthInsights = (year: number, month: number) => {
  return axios.get<MonthInsights>('/insights/month', {
    params: { year, month },
  });
};

const setPayeeClassification = (payee_key: string, kind: PayeeKind | null) => {
  return axios.put<{ ok: true }>('/insights/payee-classification', {
    payee_key,
    kind,
  });
};

export default {
  getMonthInsights,
  getEmergencyFund,
  setPayeeClassification,
};
