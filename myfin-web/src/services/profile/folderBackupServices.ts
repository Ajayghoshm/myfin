import { axios } from '../../data/axios.ts';

export type FolderBackupItem = { file: string; created_at: number; size: number };
export type FolderBackupList = {
  available: boolean;
  reason?: string;
  backups: FolderBackupItem[];
};

const list = () => axios.get<FolderBackupList>('/user/folder-backups');
const create = (password: string) =>
  axios.post<{ file: string }>('/user/folder-backups', { password });
const restore = (file: string, password: string) =>
  axios.post<string>('/user/folder-backups/restore', { file, password });

export default { list, create, restore };
