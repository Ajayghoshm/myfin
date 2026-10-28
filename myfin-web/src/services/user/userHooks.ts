import { Account, AccountType } from '../auth/authServices.ts';
import { useUserData } from '../../providers/UserProvider.tsx';
import UserServices from './userServices.ts';
import { useMutation } from '@tanstack/react-query';
import { queryClient } from '../../data/react-query.ts';
import {
  BusinessLogicError,
  CustomApiError,
} from '../../data/customApiError.ts';
import axios from 'axios';

export function useGetTopSummaryValues() {
  const { userAccounts: accounts } = useUserData();
  const operatingFundsSum =
    accounts?.reduce((result, current: Account) => {
      if (
        current.type == AccountType.Checking ||
        current.type == AccountType.Savings ||
        current.type == AccountType.Meal ||
        current.type == AccountType.Wallet
      ) {
        return result + Number(current.balance);
      }

      return result;
    }, 0) ?? 0;
  const investingSum =
    accounts?.reduce((result, current: Account) => {
      if (current.type == AccountType.Investing) {
        return result + Number(current.balance);
      }

      return result;
    }, 0) ?? 0;
  const debtSum =
    accounts?.reduce((result, current: Account) => {
      if (
        current.type == AccountType.Credit ||
        current.type == AccountType.Loan
      ) {
        return result + Number(current.balance);
      }
      return result;
    }, 0) ?? 0;
  const netWorthSum =
    accounts?.reduce((result, current: Account) => {
      return result + Number(current.balance);
    }, 0) ?? 0;

  return { operatingFundsSum, investingSum, debtSum, netWorthSum };
}

export function useGetDebtAccounts() {
  const { userAccounts: accounts } = useUserData();
  return accounts?.filter((acc) => acc.type == AccountType.Credit) ?? [];
}

export function useGetInvestingAccounts() {
  const { userAccounts: accounts } = useUserData();
  return (
    accounts?.filter(
      (acc) =>
        acc.type == AccountType.Investing || acc.type == AccountType.Savings,
    ) ?? []
  );
}

export function useGetBackupData() {
  async function getBackupData() {
    const data = await UserServices.getBackupData();
    return data.data;
  }

  return useMutation({
    mutationFn: getBackupData,
  });
}

export function useRestoreUserData() {
  async function restoreUserData(userData: string) {
    try {
      const data = await UserServices.restoreUserData(userData);
      return data.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data) {
        const errorData = error.response.data as CustomApiError;

        if (errorData.rationale && errorData.message) {
          throw new BusinessLogicError(
            errorData.rationale,
            errorData.message,
            error,
          );
        }
      }
      throw error;
    }
  }

  return useMutation({
    mutationFn: restoreUserData,
  });
}

export function useClearUserData() {
  return useMutation({
    mutationFn: async (confirmUsername: string) => {
      const data = await UserServices.clearUserData(confirmUsername);
      return data.data;
    },
  });
}

export function useGetMonthBackup() {
  return useMutation({
    mutationFn: async (month: string) =>
      (await UserServices.getMonthBackup(month)).data,
  });
}

export function useImportMonthBackup() {
  return useMutation({
    mutationFn: async (data: unknown) => {
      const result = (await UserServices.importMonthBackup(data)).data;
      // new transactions change every list, total and balance
      await queryClient.invalidateQueries();
      return result;
    },
  });
}
