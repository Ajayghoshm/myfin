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
/** Ids per request: stays under the API's 4,000-character transaction_ids limit even for 19-digit ids. */
const MATCH_CHUNK = 150;

/** Looks matches up in chunks; a planned row is offered once even across chunks. Rejects if any chunk fails. */
const getMatches = async (
  transactionIds: string[],
): Promise<PlannedMatch[]> => {
  const chunks: string[][] = [];
  for (let i = 0; i < transactionIds.length; i += MATCH_CHUNK)
    chunks.push(transactionIds.slice(i, i + MATCH_CHUNK));
  const responses = await Promise.all(
    chunks.map((ids) =>
      axios.get<PlannedMatch[]>('/planned-transactions/matches', {
        params: { transaction_ids: ids.join(',') },
      }),
    ),
  );
  const seen = new Set<string>();
  return responses
    .flatMap((r) => r.data)
    .filter((m) => {
      if (seen.has(m.planned.planned_id)) return false;
      seen.add(m.planned.planned_id);
      return true;
    });
};
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
