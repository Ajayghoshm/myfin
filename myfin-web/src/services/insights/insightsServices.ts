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

export type SafeToSpend = {
  month: string; // 'YYYY-MM'
  days_left: number;
  per_day: number;
  safe_to_spend: number;
  expected_income: number;
  income_so_far: number;
  typical_income: number | null;
  spent_so_far: number;
  fixed_still_to_come: number;
  fixed_lines: Array<{
    category_id: string;
    name: string;
    typical: number;
    spent: number;
    remaining: number;
  }>;
  savings_target: number;
  yearly_setaside: number;
  emergency_topup: number;
  has_fixed_categories: boolean;
};

export type Forecast = {
  month: string;
  income: number;
  total: number;
  low: number;
  high: number;
  unsorted: number;
  categories: Array<{
    category_id: string | null;
    name: string;
    kind: 'fixed' | 'flexible' | 'income';
    amount: number;
    yearly_costs: number;
    seasonal_factor: number | null;
  }>;
};

export type ForecastBudgetMode = 'create' | 'replace' | 'fill_empty';

export type ForecastBudgetCompare = {
  budget_id: string | null;
  rows: Array<{
    category_id: string;
    name: string;
    current_debit: number;
    current_credit: number;
    forecast_debit: number;
    forecast_credit: number;
    has_breakdown: boolean;
  }>;
};

const getForecast = (month: string) =>
  axios.get<Forecast>('/insights/forecast', { params: { month } });

const getForecastBudgetCompare = (month: string) =>
  axios.get<ForecastBudgetCompare>('/insights/forecast/budget-compare', {
    params: { month },
  });

const createBudgetFromForecast = (month: string, mode: ForecastBudgetMode) =>
  axios.post<{ budget_id: string; skipped_category_ids: string[] }>(
    '/insights/forecast/budget',
    { month, mode },
  );

const getSafeToSpend = () => axios.get<SafeToSpend>('/insights/safe-to-spend');

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
  getSafeToSpend,
  getForecast,
  getForecastBudgetCompare,
  createBudgetFromForecast,
  setPayeeClassification,
};
