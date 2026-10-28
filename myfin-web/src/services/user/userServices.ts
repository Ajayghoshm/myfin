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

export default {
  getBackupData,
  clearUserData,
  restoreUserData,
};
