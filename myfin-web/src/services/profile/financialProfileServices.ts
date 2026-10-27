import { axios } from '../../data/axios.ts';

export type FinancialProfile = {
  salary_category_id: string | null;
  salary_cutoff_day: number;
};

export type FinancialProfilePatch = {
  salary_category_id?: number | null;
  salary_cutoff_day?: number;
};

const getFinancialProfile = () => {
  return axios.get<FinancialProfile>('/user/financial-profile');
};

const updateFinancialProfile = (patch: FinancialProfilePatch) => {
  return axios.put<FinancialProfile>('/user/financial-profile', patch);
};

export default { getFinancialProfile, updateFinancialProfile };
