import { useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../../data/react-query.ts';
import { QUERY_KEY_GET_ACCOUNTS } from '../account/accountHooks.ts';
import {
  QUERY_KEY_GET_DAILY_SPEND,
  QUERY_KEY_GET_EMERGENCY_FUND,
  QUERY_KEY_GET_FORECAST,
  QUERY_KEY_GET_MONTH_INSIGHTS,
  QUERY_KEY_GET_SAFE_TO_SPEND,
  QUERY_KEY_GET_SMALL_SPENDS,
} from '../insights/insightsHooks.ts';
import { QUERY_KEY_GET_TRANSACTIONS } from '../trx/trxHooks.ts';
import {
  QUERY_KEY_GET_DEBTS,
  QUERY_KEY_GET_DISBURSEMENT_CANDIDATES,
  QUERY_KEY_GET_INSTALLMENT_CANDIDATES,
  QUERY_KEY_GET_LOAN_MATCH_SUGGESTIONS,
  QUERY_KEY_GET_LOAN_PREPAYMENT,
  QUERY_KEY_GET_LOANS,
  QUERY_KEY_GET_REPAYMENT_SUGGESTIONS,
} from './debtQueryKeys.ts';
import debtServices, {
  DebtUpdateInput,
  LoanInput,
  PeopleDebtInput,
  RepaymentInput,
} from './debtServices.ts';

export { QUERY_KEY_GET_DEBTS, QUERY_KEY_GET_REPAYMENT_SUGGESTIONS };

// Linking rows to debts changes what counts as spending and income
const invalidateAll = () => {
  for (const key of [
    QUERY_KEY_GET_DEBTS,
    QUERY_KEY_GET_REPAYMENT_SUGGESTIONS,
    QUERY_KEY_GET_MONTH_INSIGHTS,
    QUERY_KEY_GET_SAFE_TO_SPEND,
    QUERY_KEY_GET_SMALL_SPENDS,
    QUERY_KEY_GET_DAILY_SPEND,
    QUERY_KEY_GET_EMERGENCY_FUND,
    QUERY_KEY_GET_FORECAST,
    QUERY_KEY_GET_TRANSACTIONS,
    QUERY_KEY_GET_LOANS,
    QUERY_KEY_GET_LOAN_MATCH_SUGGESTIONS,
    QUERY_KEY_GET_LOAN_PREPAYMENT,
    QUERY_KEY_GET_DISBURSEMENT_CANDIDATES,
    QUERY_KEY_GET_INSTALLMENT_CANDIDATES,
    // Loans own an account whose balance moves with every EMI
    QUERY_KEY_GET_ACCOUNTS,
  ])
    void queryClient.invalidateQueries({ queryKey: [key] });
};

export function useGetDebts() {
  return useQuery({
    queryKey: [QUERY_KEY_GET_DEBTS],
    queryFn: async () => (await debtServices.getDebts()).data,
  });
}

export function useGetRepaymentSuggestions(id: string | null) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_REPAYMENT_SUGGESTIONS, id],
    queryFn: async () =>
      (await debtServices.getRepaymentSuggestions(id as string)).data,
    enabled: id !== null,
  });
}

export function useCreateDebt() {
  return useMutation({
    mutationFn: async (input: PeopleDebtInput) =>
      (await debtServices.createDebt(input)).data,
    onSuccess: invalidateAll,
  });
}

export function useUpdateDebt() {
  return useMutation({
    mutationFn: async (input: { id: string; data: DebtUpdateInput }) =>
      (await debtServices.updateDebt(input.id, input.data)).data,
    onSuccess: invalidateAll,
  });
}

export function useDeleteDebt() {
  return useMutation({
    mutationFn: async (id: string) => (await debtServices.deleteDebt(id)).data,
    onSuccess: invalidateAll,
  });
}

export function useAddRepayment() {
  return useMutation({
    mutationFn: async (input: { id: string; data: RepaymentInput }) =>
      (await debtServices.addRepayment(input.id, input.data)).data,
    onSuccess: invalidateAll,
  });
}

export function useDeleteRepayment() {
  return useMutation({
    mutationFn: async (input: { id: string; paymentId: string }) =>
      (await debtServices.deleteRepayment(input.id, input.paymentId)).data,
    onSuccess: invalidateAll,
  });
}

export function useGetLoans() {
  return useQuery({
    queryKey: [QUERY_KEY_GET_LOANS],
    queryFn: async () => (await debtServices.getLoans()).data,
  });
}

export function useGetLoanMatchSuggestions(id: string | null) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_LOAN_MATCH_SUGGESTIONS, id],
    queryFn: async () =>
      (await debtServices.getLoanMatchSuggestions(id as string)).data,
    enabled: id !== null,
  });
}

export function useGetPrepayment(
  id: string,
  amount: number | null,
  afterInstallment: number,
) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_LOAN_PREPAYMENT, id, amount, afterInstallment],
    queryFn: async () =>
      (await debtServices.getPrepayment(id, amount as number, afterInstallment))
        .data,
    enabled: amount !== null && amount > 0,
  });
}

export function useCreateLoan() {
  return useMutation({
    mutationFn: async (input: LoanInput) =>
      (await debtServices.createLoan(input)).data,
    onSuccess: invalidateAll,
  });
}

export function useMatchInstallment() {
  return useMutation({
    mutationFn: async (input: {
      id: string;
      n: number;
      transactionId: number;
    }) =>
      (
        await debtServices.matchInstallment(
          input.id,
          input.n,
          input.transactionId,
        )
      ).data,
    onSuccess: invalidateAll,
  });
}

export function useMarkInstallmentPaid() {
  return useMutation({
    mutationFn: async (input: { id: string; n: number; date?: number }) =>
      (await debtServices.markInstallmentPaid(input.id, input.n, input.date))
        .data,
    onSuccess: invalidateAll,
  });
}

export function useUnpayInstallment() {
  return useMutation({
    mutationFn: async (input: { id: string; n: number }) =>
      (await debtServices.unpayInstallment(input.id, input.n)).data,
    onSuccess: invalidateAll,
  });
}

export function useMarkPastInstallmentsPaid() {
  return useMutation({
    mutationFn: async (id: string) =>
      (await debtServices.markPastInstallmentsPaid(id)).data,
    onSuccess: invalidateAll,
  });
}

export function useGetDisbursementCandidates(date: number | null) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_DISBURSEMENT_CANDIDATES, date],
    queryFn: async () =>
      (await debtServices.getDisbursementCandidates(date as number)).data,
    enabled: date !== null,
  });
}

export function useGetInstallmentCandidates(id: string, n: number | null) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_INSTALLMENT_CANDIDATES, id, n],
    queryFn: async () =>
      (await debtServices.getInstallmentCandidates(id, n as number)).data,
    enabled: n !== null,
  });
}

export function useLinkDisbursement() {
  return useMutation({
    mutationFn: async (input: { id: string; transactionId: number }) =>
      (await debtServices.linkDisbursement(input.id, input.transactionId)).data,
    onSuccess: invalidateAll,
  });
}

export function useUnlinkDisbursement() {
  return useMutation({
    mutationFn: async (id: string) =>
      (await debtServices.unlinkDisbursement(id)).data,
    onSuccess: invalidateAll,
  });
}
