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

export type InstallmentStatus = 'paid' | 'due' | 'missed';

export type Installment = {
  n: number;
  /** YYYY-MM-DD. */
  date: string;
  date_epoch: number;
  emi: number;
  interest: number;
  principal: number;
  balance: number;
  status: InstallmentStatus;
  paid_via: 'matched' | 'manual' | null;
  paid_date: number | null;
  payment_id: string | null;
  transaction_id: string | null;
};

export type Loan = {
  debt_id: string;
  kind: 'loan';
  lender: string;
  principal: number;
  rate: number;
  tenure_months: number;
  emi: number;
  emi_day: number;
  account_id: string | null;
  loan_account_id: string | null;
  start_date: number;
  status: 'open' | 'settled';
  outstanding_principal: number;
  interest_paid: number;
  emis_paid: number;
  emis_left: number;
  missed_count: number;
  end_date: string;
  next_due: { n: number; date: string; emi: number } | null;
  /** The income the loan was paid out into, if linked. */
  disbursement: TransactionRef | null;
  schedule: Installment[];
};

export type LoanInput = {
  lender: string;
  principal: number;
  rate: number;
  tenure_months: number;
  emi?: number | null;
  emi_day: number;
  account_id: number;
  start_date: number;
  disbursement_transaction_id?: number | null;
};

export type TransactionRef = {
  transaction_id: string;
  description: string;
  amount: number;
  date: number;
};

export type LoanMatchSuggestion = {
  n: number;
  transaction_id: string;
  description: string;
  amount: number;
  date: number;
};

export type PrepaymentResult = {
  months_saved: number;
  interest_saved: number;
  new_end_date: string;
};

const getLoans = () => axios.get<Loan[]>('/debts/loans');
const createLoan = (input: LoanInput) =>
  axios.post<Loan>('/debts/loans', input);
const getLoanMatchSuggestions = (id: string) =>
  axios.get<LoanMatchSuggestion[]>(`/debts/loans/${id}/match-suggestions`);
const matchInstallment = (id: string, n: number, transactionId: number) =>
  axios.post<Loan>(`/debts/loans/${id}/installments/${n}/match`, {
    transaction_id: transactionId,
  });
const markInstallmentPaid = (id: string, n: number, date?: number) =>
  axios.post<Loan>(`/debts/loans/${id}/installments/${n}/mark-paid`, {
    date: date ?? null,
  });
const unpayInstallment = (id: string, n: number) =>
  axios.post<Loan>(`/debts/loans/${id}/installments/${n}/unpay`);
const markPastInstallmentsPaid = (id: string) =>
  axios.post<Loan>(`/debts/loans/${id}/mark-past-paid`);
const getPrepayment = (id: string, amount: number, afterInstallment: number) =>
  axios.get<PrepaymentResult>(`/debts/loans/${id}/prepayment`, {
    params: { amount, after_installment: afterInstallment },
  });

const getDisbursementCandidates = (date: number) =>
  axios.get<TransactionRef[]>('/debts/loans/disbursement-candidates', {
    params: { date },
  });
const linkDisbursement = (id: string, transactionId: number) =>
  axios.post<Loan>(`/debts/loans/${id}/disbursement`, {
    transaction_id: transactionId,
  });
const unlinkDisbursement = (id: string) =>
  axios.delete<Loan>(`/debts/loans/${id}/disbursement`);
const getInstallmentCandidates = (id: string, n: number) =>
  axios.get<TransactionRef[]>(
    `/debts/loans/${id}/installments/${n}/candidates`,
  );

export default {
  getDisbursementCandidates,
  linkDisbursement,
  unlinkDisbursement,
  getInstallmentCandidates,
  getLoans,
  createLoan,
  getLoanMatchSuggestions,
  matchInstallment,
  markInstallmentPaid,
  unpayInstallment,
  markPastInstallmentsPaid,
  getPrepayment,
  getDebts,
  createDebt,
  updateDebt,
  deleteDebt,
  addRepayment,
  getRepaymentSuggestions,
  deleteRepayment,
};
