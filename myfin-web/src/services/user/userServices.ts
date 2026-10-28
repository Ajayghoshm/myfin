import { axios } from '../../data/axios.ts';

const getBackupData = () => {
  return axios.get<string>('/user/backup');
};

export enum RestoreUserErrorCodes {
  IncompatibleVersions = 'INCOMPATIBLE_VERSIONS',
}

const restoreUserData = (userData: string) => {
  return axios.put<string>('/user/restore', JSON.parse(userData));
};

const clearUserData = (confirmUsername: string) => {
  return axios.post<string>('/user/clear', {
    confirm_username: confirmUsername,
  });
};

export type ImportMonthResult = {
  month: string;
  imported: number;
  skipped: number;
  created: {
    accounts: number;
    categories: number;
    entities: number;
    tags: number;
  };
};

const getMonthBackup = (month: string) => {
  return axios.get<unknown>('/user/backup/month', { params: { month } });
};

const importMonthBackup = (data: unknown) => {
  return axios.post<ImportMonthResult>('/user/restore/month', data);
};

export default {
  getMonthBackup,
  importMonthBackup,
  getBackupData,
  clearUserData,
  restoreUserData,
};
