import { useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../../data/react-query.ts';
import folderBackupServices from './folderBackupServices.ts';

export const QUERY_KEY_FOLDER_BACKUPS = 'QUERY_KEY_FOLDER_BACKUPS';

export function useGetFolderBackups() {
  return useQuery({
    queryKey: [QUERY_KEY_FOLDER_BACKUPS],
    queryFn: async () => (await folderBackupServices.list()).data,
  });
}

export function useCreateFolderBackup() {
  return useMutation({
    mutationFn: async (password: string) =>
      (await folderBackupServices.create(password)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_FOLDER_BACKUPS] });
    },
  });
}

export function useRestoreFolderBackup() {
  return useMutation({
    mutationFn: async (args: { file: string; password: string }) =>
      (await folderBackupServices.restore(args.file, args.password)).data,
    onSuccess: () => {
      // restored data replaces everything: refetch all cached queries
      void queryClient.invalidateQueries();
    },
  });
}
