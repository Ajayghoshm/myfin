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
  /** Still to transfer this month. */
  savings_target: number;
  yearly_setaside: number;
  emergency_topup: number;
  /** Deducted from safe-to-spend: max(target, already transferred). */
  savings_deducted: number;
  yearly_deducted: number;
  emergency_deducted: number;
  has_fixed_categories: boolean;
};

export type Forecast = {
  month: string;
  income: number;
  /** Part of `income` with no category (no budget line holds it). */
  uncategorised_income: number;
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

export type SmallSpends = {
  month: string;
  /** Currency. */
  cutoff: number;
  count: number;
  total: number;
  typical_total: number | null;
  typical_count: number | null;
  places: Array<{
    payee_key: string;
    name: string;
    count: number;
    total: number;
    average: number;
  }>;
  trend: Array<{ year: number; month: number; count: number; total: number }>;
};

export type DailySpend = {
  from: string;
  to: string;
  flexible_only: boolean;
  days: Array<{ date: string; total: number; count: number }>;
  /** index 0 = Monday ... 6 = Sunday */
  weekday_avg: number[];
  /** 4 cut points over non-zero day totals, for 5 shades */
  quantiles: number[];
};

const getDailySpend = (from: string, to: string, flexibleOnly: boolean) =>
  axios.get<DailySpend>('/insights/daily', {
    params: { from, to, flexible_only: flexibleOnly ? 1 : 0 },
  });

export type NetWorthParts = {
  saved: number;
  investment_growth: number;
  write_offs: number;
  other: number;
};

/** #17: currency amounts; `parts` sum exactly to `change`. */
export type NetWorthChange = {
  month: string;
  /** Epoch seconds: the month's start and its end (clamped to now). */
  from: number;
  to: number;
  start: number;
  end: number;
  change: number;
  parts: NetWorthParts;
  /** Informational; overlaps with the parts. */
  debt_paid_down: number;
  /** account_id 'investments' / 'people' are the holdings and lent − borrowed lines. */
  accounts: Array<{
    account_id: string;
    name: string;
    type: string;
    start: number;
    end: number;
    change: number;
  }>;
  trend: Array<{ year: number; month: number; change: number } & NetWorthParts>;
};

const getNetWorth = (month: string) =>
  axios.get<NetWorthChange>('/insights/net-worth', { params: { month } });

const getSmallSpends = (month: string) =>
  axios.get<SmallSpends>('/insights/small-spends', { params: { month } });

const getSafeToSpend = () => axios.get<SafeToSpend>('/insights/safe-to-spend');

export type HealthCheckStatus = 'pass' | 'fail' | 'not_set_up';

export type HealthCheckKey =
  | 'savings_rate'
  | 'emergency_fund'
  | 'yearly_costs'
  | 'fixed_costs'
  | 'credit_cards'
  | 'debt_emis'
  | 'data';

export type HealthTextParams = Record<string, string | number>;

export type HealthCheck = {
  key: HealthCheckKey;
  status: HealthCheckStatus;
  /** English figure; `value_key` + `value_params` localise it. */
  value: string | null;
  value_key: string | null;
  value_params: HealthTextParams;
  /** English hint; `hint_key` + `hint_params` localise it. */
  hint: string;
  hint_key: string;
  hint_params: HealthTextParams;
  link: string;
};

/** 'N of M passed' for a month; `total` excludes not-set-up checks. */
export type HealthScore = {
  month: string;
  passed: number;
  total: number;
  checks: HealthCheck[];
  /** A past month's stored score, which never changes. */
  frozen: boolean;
  /** A past month first read 3+ months later: computed from today's data, not stored. */
  reconstructed: boolean;
};

/** `month` is 'YYYY-MM'; omitted = the current month. */
const getHealth = (month?: string) =>
  axios.get<HealthScore>('/insights/health', {
    params: month ? { month } : {},
  });

const getHealthHistory = () =>
  axios.get<HealthScore[]>('/insights/health/history');

export type ReviewStepKey =
  | 'import'
  | 'sort'
  | 'reconcile'
  | 'planned'
  | 'review'
  | 'plan';

export type ReviewStep = {
  key: ReviewStepKey;
  status: 'done' | 'todo' | 'nothing_to_do';
  /** English fallback; `detail_key` + `detail_params` localise it. */
  detail: string;
  detail_key: string;
  detail_params: Record<string, string | number>;
  link: string;
  items?: { id: string; label: string; link: string }[];
};

export type MonthReview = {
  month: string;
  done: number;
  total: 6;
  complete: boolean;
  steps: ReviewStep[];
  /** A past month's stored review, which never changes. */
  frozen: boolean;
  /** A past month first read 3+ months later: computed from today's data, not stored. */
  reconstructed: boolean;
  /** The month ends before the user's data starts. */
  before_data: boolean;
};

export type ReviewHistoryEntry = {
  month: string;
  done: number;
  total: 6;
  complete: boolean;
  frozen: boolean;
  reconstructed: boolean;
};

/** `month` is 'YYYY-MM'; omitted = the previous month. */
const getReview = (month?: string) =>
  axios.get<MonthReview>('/review', { params: month ? { month } : {} });

const getReviewHistory = () =>
  axios.get<ReviewHistoryEntry[]>('/review/history');

const setReviewed = (month: string, reviewed: boolean) =>
  axios.post<{ month: string; reviewed: boolean }>(
    `/review/${month}/reviewed`,
    { reviewed },
  );

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
  getHealth,
  getHealthHistory,
  getReview,
  getReviewHistory,
  setReviewed,
  getSafeToSpend,
  getSmallSpends,
  getNetWorth,
  getDailySpend,
  getForecast,
  getForecastBudgetCompare,
  createBudgetFromForecast,
  setPayeeClassification,
};
