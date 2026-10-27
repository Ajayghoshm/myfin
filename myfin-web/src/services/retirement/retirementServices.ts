import { axios } from '../../data/axios.ts';

export type RetirementOverrides = {
  returnPct?: number;
  inflationPct?: number;
  swrPct?: number;
  retirementAge?: number;
  monthlyInvestment?: number;
};

export type RetirementMissing =
  | 'date_of_birth'
  | 'spending_history'
  | 'swr'
  | 'retirement_age';

export type RetirementResult = {
  inputs: {
    age: number | null;
    retirement_age: number;
    annual_spending_today: number | null;
    spending_basis: 'all' | 'fixed';
    return_pct: number;
    inflation_pct: number;
    swr_pct: number;
    family_support_monthly: number;
    family_support_years: number;
    current_corpus: number;
    monthly_investment: number;
  };
  missing: RetirementMissing[];
  corpus_needed: { future: number; today: number } | null;
  on_track_age: number | null;
  extra_monthly_needed: number | null;
  projection: Array<{ age: number; corpus: number; needed: number }>;
};

const getRetirement = () => axios.get<RetirementResult>('/retirement');

const whatIf = (overrides: RetirementOverrides) =>
  axios.post<RetirementResult>('/retirement/what-if', { overrides });

const saveWhatIf = (overrides: RetirementOverrides) =>
  axios.post<RetirementResult>('/retirement/save-what-if', { overrides });

export default { getRetirement, whatIf, saveWhatIf };
