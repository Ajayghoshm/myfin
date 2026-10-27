import { axios } from '../../data/axios.ts';

export type SavingsTargetMode = 'amount' | 'percent';

export type FinancialProfile = {
  salary_category_id: string | null;
  salary_cutoff_day: number;
  savings_target_mode: SavingsTargetMode;
  /** Currency in amount mode, whole percent in percent mode. */
  savings_target_value: number;
  savings_target_account_id: string | null;
  sinking_fund_account_id: string | null;
  emergency_fund_target_months: number;
  emergency_topup_percent: number;
  /** Currency: payments below this are small spends. */
  small_spend_cutoff: number;
  /** 'YYYY-MM-DD' or null. */
  date_of_birth: string | null;
  retirement_age: number;
  expected_return_pct: number;
  inflation_pct: number;
  swr_pct: number;
  retirement_spending_basis: 'all' | 'fixed';
  family_support_monthly: number;
  family_support_years: number;
  retirement_account_ids: string[];
  retirement_asset_ids: string[];
};

export type FinancialProfilePatch = {
  salary_category_id?: number | null;
  salary_cutoff_day?: number;
  savings_target_mode?: SavingsTargetMode;
  savings_target_value?: number;
  savings_target_account_id?: number | null;
  sinking_fund_account_id?: number | null;
  emergency_fund_target_months?: number;
  emergency_topup_percent?: number;
  small_spend_cutoff?: number;
  date_of_birth?: string | null;
  retirement_age?: number;
  expected_return_pct?: number;
  inflation_pct?: number;
  swr_pct?: number;
  retirement_spending_basis?: 'all' | 'fixed';
  family_support_monthly?: number;
  family_support_years?: number;
  retirement_account_ids?: number[];
  retirement_asset_ids?: number[];
};

const getFinancialProfile = () => {
  return axios.get<FinancialProfile>('/user/financial-profile');
};

const updateFinancialProfile = (patch: FinancialProfilePatch) => {
  return axios.put<FinancialProfile>('/user/financial-profile', patch);
};

export default { getFinancialProfile, updateFinancialProfile };
