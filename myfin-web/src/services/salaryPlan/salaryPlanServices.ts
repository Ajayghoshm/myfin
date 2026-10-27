import { axios } from '../../data/axios.ts';

export type BucketName = 'fixed' | 'yearly' | 'emergency' | 'savings' | 'free';
export type BucketState = 'none' | 'planned' | 'done' | 'skipped';

export type SalaryBucket = {
  bucket: BucketName;
  amount: number;
  account_to_id: string | null;
  planned_id: string | null;
  state: BucketState;
  transaction_id: string | null;
  overdue: boolean;
};

export type SalaryPlan = {
  state: 'none' | 'proposal' | 'confirmed';
  /** 'YYYY-MM' */
  month: string | null;
  salary: { transaction_id: string; amount: number; date: number } | null;
  buckets: SalaryBucket[];
};

export type ConfirmSalaryPlanInput = {
  month: string;
  salary_transaction_id: number;
  buckets: {
    bucket: BucketName;
    amount: number;
    account_to_id: number | null;
  }[];
};

const getCurrent = () => axios.get<SalaryPlan>('/salary-plan/current');
const getByMonth = (month: string) =>
  axios.get<SalaryPlan>(`/salary-plan/${month}`);
const confirm = (input: ConfirmSalaryPlanInput) =>
  axios.post<{ salary_plan_id: string }>('/salary-plan', input);

export default { getCurrent, getByMonth, confirm };
