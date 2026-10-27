import { axios } from '../../data/axios.ts';

export type PlannedRow = {
  planned_id: string;
  date_timestamp: number;
  amount: number;
  type: string;
  account_from_id: string | null;
  account_to_id: string | null;
  category_id: string | null;
  description: string;
  salary_plan_id: string | null;
  bucket: string | null;
  created_at: number;
};

export type PlannedMatch = { transaction_id: string; planned: PlannedRow };

export type PlannedCandidate = {
  transaction_id: string;
  date_timestamp: number;
  amount: number;
  type: string;
  description: string;
};

const getPlanned = () => axios.get<PlannedRow[]>('/planned-transactions');
const getMatches = (transactionIds: string[]) =>
  axios.get<PlannedMatch[]>('/planned-transactions/matches', {
    params: { transaction_ids: transactionIds.join(',') },
  });
const getCandidates = (plannedId: string) =>
  axios.get<PlannedCandidate[]>(
    `/planned-transactions/${plannedId}/candidates`,
  );
const markDone = (plannedId: string) =>
  axios.post<{ transaction_id: string }>(
    `/planned-transactions/${plannedId}/done`,
  );
const skip = (plannedId: string) =>
  axios.post<{ ok: true }>(`/planned-transactions/${plannedId}/skip`);
const confirmMatch = (plannedId: string, transactionId: string) =>
  axios.post<{ ok: true }>(`/planned-transactions/${plannedId}/match`, {
    transaction_id: Number(transactionId),
  });

export default {
  getPlanned,
  getMatches,
  getCandidates,
  markDone,
  skip,
  confirmMatch,
};
