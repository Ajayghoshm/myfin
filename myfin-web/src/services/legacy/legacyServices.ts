import { axios } from '../../data/axios.ts';
import type { Debt, Loan } from '../debts/debtServices.ts';

export type LegacyKind = 'account' | 'policy' | 'contact' | 'instruction';

export type LegacyData = Record<string, string | number | null>;

export type LegacyEntry = {
  entry_id: string;
  kind: LegacyKind;
  account_id: string | null;
  data: LegacyData;
  sort_order: number;
};

export type LegacyAccount = {
  account_id: string;
  name: string;
  type: string;
  status: string;
  balance: number;
};

export type LegacySuggestion = {
  payee_key: string;
  last_amount: number;
  last_date: number;
};

export type LegacyResponse = {
  entries: LegacyEntry[];
  accounts: LegacyAccount[];
  debts: {
    loans: Omit<Loan, 'schedule'>[];
    people: Debt[];
    totals: { owed_to_you: number; you_owe: number };
  };
  suggestions: LegacySuggestion[];
};

export type LegacyInput = {
  kind: LegacyKind;
  account_id?: string | null;
  data: LegacyData;
};

const getLegacy = () => axios.get<LegacyResponse>('/legacy');
const createEntry = (input: LegacyInput) =>
  axios.post<LegacyEntry>('/legacy', input);
const updateEntry = (id: string, data: LegacyData) =>
  axios.put<LegacyEntry>(`/legacy/${id}`, { data });
const deleteEntry = (id: string) => axios.delete<{ ok: true }>(`/legacy/${id}`);

export default { getLegacy, createEntry, updateEntry, deleteEntry };
