import { axios } from '../../data/axios.ts';

export type YearlyCost = {
  yearly_cost_id: string;
  name: string;
  amount: number;
  due_month: number;
  category_id: string | null;
  category_name: string | null;
  active: boolean;
  linked_count: number;
};

export type YearlyCostInput = {
  name: string;
  amount: number;
  due_month: number;
  category_id: number | null;
  active?: boolean;
  /** Accepting a suggestion: link this payment to the new cost. */
  link_transaction_id?: number | null;
};

export type SinkingStatus = {
  account: { account_id: string; name: string; balance: number } | null;
  monthly_total: number;
  should_have: number;
  behind_by: number;
  catch_up_this_month: number;
  on_track: boolean;
  upcoming: Array<{
    yearly_cost_id: string;
    name: string;
    amount: number;
    due_month: number;
  }>;
};

export type YearlyCostSuggestion = {
  transaction_id: string;
  payee_key: string;
  description: string;
  amount: number;
  date: number;
  category_id: string | null;
  suggested_due_month: number;
};

export type YearlyCostCandidate = {
  transaction_id: string;
  payee_key: string;
  description: string;
  amount: number;
  date: number;
  category_id: string | null;
};

const getYearlyCosts = () =>
  axios.get<{ costs: YearlyCost[]; status: SinkingStatus }>('/yearly-costs');
const createYearlyCost = (input: YearlyCostInput) =>
  axios.post<YearlyCost>('/yearly-costs', input);
const updateYearlyCost = (id: string, input: YearlyCostInput) =>
  axios.put<YearlyCost>(`/yearly-costs/${id}`, input);
const deleteYearlyCost = (id: string) =>
  axios.delete<{ ok: true }>(`/yearly-costs/${id}`);
const getSuggestions = () =>
  axios.get<YearlyCostSuggestion[]>('/yearly-costs/suggestions');
const dismissSuggestion = (payee_key: string) =>
  axios.post<{ ok: true }>('/yearly-costs/suggestions/dismiss', { payee_key });
const getCandidates = (id: string) =>
  axios.get<YearlyCostCandidate[]>(`/yearly-costs/${id}/candidates`);
const linkTransaction = (
  transaction_id: string,
  yearly_cost_id: string | null,
) =>
  axios.post<{ ok: true }>('/yearly-costs/link', {
    transaction_id: Number(transaction_id),
    yearly_cost_id: yearly_cost_id === null ? null : Number(yearly_cost_id),
  });

export default {
  getYearlyCosts,
  createYearlyCost,
  updateYearlyCost,
  deleteYearlyCost,
  getSuggestions,
  dismissSuggestion,
  getCandidates,
  linkTransaction,
};
