import { axios } from '../../data/axios.ts';
import { Account, AccountStatus, AccountType } from '../auth/authServices.ts';
import { ColorGradient } from '../../consts/index.ts';

const getAccounts = () => {
  return axios.get<Account[]>(`/accounts`);
};

const removeAccount = (id: bigint) => {
  return axios.delete<string>(`/accounts`, { data: { account_id: id } });
};

export type AddAccountRequest = {
  name: string;
  type: AccountType;
  description?: string;
  status: AccountStatus;
  exclude_from_budgets: boolean;
  current_balance?: number;
  color_gradient: ColorGradient;
  stale_after_days?: number | null;
};

const addAccount = (request: AddAccountRequest) => {
  return axios.post('/accounts', { current_balance: 0, ...request });
};

export type EditAccountRequest = {
  account_id: bigint;
  new_name: string;
  new_type: AccountType;
  new_description?: string;
  new_status: AccountStatus;
  exclude_from_budgets: boolean;
  current_balance?: number;
  color_gradient: ColorGradient;
  new_stale_after_days?: number | null;
};

const editAccount = (request: EditAccountRequest) => {
  return axios.put('/accounts', { current_balance: 0, ...request });
};

export type BalanceCheckRow = {
  account_id: string;
  name: string;
  type: AccountType;
  /** Comparable form: the amount owed (positive) for credit cards. */
  myfin_balance: number;
  last_check: { checked_at: number; result: string; gap: number } | null;
};

const getBalanceCheck = () => {
  return axios.get<BalanceCheckRow[]>('/accounts/balance-check');
};

const saveBalanceCheck = (request: {
  account_id: string;
  real_balance: number;
}) => {
  return axios.post<{ gap: number; result: string }>(
    '/accounts/balance-check',
    request,
  );
};

const writeOffBalanceGap = (request: {
  account_id: string;
  real_balance: number;
}) => {
  return axios.post<{ transaction_id: string }>(
    '/accounts/balance-check/write-off',
    request,
  );
};

const recalculateAllBalances = () => {
  return axios.get('/accounts/recalculate-balance/all');
};

const autoPopulateWithDemoData = () => {
  return axios.post('/users/demo');
};

export default {
  getAccounts,
  removeAccount,
  addAccount,
  editAccount,
  getBalanceCheck,
  saveBalanceCheck,
  writeOffBalanceGap,
  recalculateAllBalances,
  autoPopulateWithDemoData,
};
