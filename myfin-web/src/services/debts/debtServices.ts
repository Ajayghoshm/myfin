import { axios } from '../../data/axios.ts';

export type DebtKind = 'lent' | 'borrowed' | 'loan';
export type PeopleDebtKind = 'lent' | 'borrowed';

export type DebtPayment = {
  payment_id: string;
  date: number;
  amount: number;
  principal_part: number;
  interest_part: number;
  transaction_id: string | null;
  description: string | null;
  manual: boolean;
};

export type Debt = {
  debt_id: string;
  kind: DebtKind;
  counterparty_name: string;
  counterparty_key: string | null;
  principal: number;
  rate: number;
  repaid: number;
  /** Never below 0. */
  outstanding: number;
  start_date: number;
  due_date: number | null;
  note: string | null;
  status: 'open' | 'settled';
  overdue: boolean;
  display_status: 'outstanding' | 'settled' | 'overdue';
  /** The transaction the entry was created from. */
  transaction_id: string | null;
  payments: DebtPayment[];
};

export type DebtsResponse = {
  debts: Debt[];
  totals: { owed_to_you: number; you_owe: number };
};

export type PeopleDebtInput = {
  kind: PeopleDebtKind;
  name: string;
  amount?: number;
  date?: number;
  due_date?: number | null;
  note?: string | null;
  transaction_id?: number | null;
};

export type DebtUpdateInput = {
  name: string;
  amount?: number;
  date?: number;
  due_date?: number | null;
  note?: string | null;
};

export type RepaymentInput = {
  amount?: number;
  date?: number;
  transaction_id?: number | null;
};

export type RepaymentSuggestion = {
  transaction_id: string;
  description: string;
  amount: number;
  date: number;
};

const getDebts = () => axios.get<DebtsResponse>('/debts');
const createDebt = (input: PeopleDebtInput) =>
  axios.post<Debt>('/debts', input);
const updateDebt = (id: string, input: DebtUpdateInput) =>
  axios.put<Debt>(`/debts/${id}`, input);
const deleteDebt = (id: string) => axios.delete<{ ok: true }>(`/debts/${id}`);
const addRepayment = (id: string, input: RepaymentInput) =>
  axios.post<Debt>(`/debts/${id}/repayments`, input);
const getRepaymentSuggestions = (id: string) =>
  axios.get<RepaymentSuggestion[]>(`/debts/${id}/repayment-suggestions`);
const deleteRepayment = (id: string, paymentId: string) =>
  axios.delete<Debt>(`/debts/${id}/repayments/${paymentId}`);

export default {
  getDebts,
  createDebt,
  updateDebt,
  deleteDebt,
  addRepayment,
  getRepaymentSuggestions,
  deleteRepayment,
};
