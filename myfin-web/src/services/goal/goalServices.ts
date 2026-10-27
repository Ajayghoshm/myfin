import { axios } from '../../data/axios.ts';

export type FundingAccount = {
  account_id: number;
  funding_type: 'absolute' | 'relative';
  funding_amount: number;
  current_funding?: number;
};

export type FundingAsset = {
  asset_id: number;
  funding_type: 'absolute' | 'relative';
  funding_amount: number;
};

export type GoalAssetFunding = {
  asset_id: string;
  match_type: 'absolute' | 'relative';
  match_value: number;
  funded: number;
};

export type Goal = {
  goal_id: bigint;
  name: string;
  description: string;
  priority: number;
  amount: number;
  due_date: number | null;
  is_archived: boolean;
  currently_funded_amount: number;
  is_underfunded: boolean;
  is_underfunded_by_priority: boolean;
  funding_accounts: FundingAccount[];
  assets: GoalAssetFunding[];
  asset_funding: number;
  monthly_sip: number;
  on_track: boolean | null;
};

export type GoalFundingSummary = {
  goals: Goal[];
  unallocated_funding: {
    total_amount: number;
    accounts: Array<{
      account_id: number;
      amount: number;
    }>;
  };
  unallocated_assets: Array<{
    asset_id: string;
    value: number;
    amount: number;
  }>;
};

export type CreateGoalRequest = {
  name: string;
  description: string;
  priority: number;
  amount: number;
  due_date?: number | null;
  funding_accounts: Omit<FundingAccount, 'current_funding'>[];
  funding_assets: FundingAsset[];
};

export type UpdateGoalRequest = CreateGoalRequest & {
  is_archived?: boolean;
};

const getGoals = (onlyActive: boolean = false) => {
  return axios.get<GoalFundingSummary>(`/goals`, {
    params: onlyActive ? { only_active: true } : undefined,
  });
};

const createGoal = (request: CreateGoalRequest) => {
  return axios.post<string>(`/goals`, request);
};

const updateGoal = (goalId: bigint, request: UpdateGoalRequest) => {
  return axios.put<string>(`/goals/${goalId}`, request);
};

const deleteGoal = (goalId: bigint) => {
  return axios.delete<string>(`/goals/${goalId}`);
};

export default {
  getGoals,
  createGoal,
  updateGoal,
  deleteGoal,
};
