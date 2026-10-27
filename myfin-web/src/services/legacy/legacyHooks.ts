import { useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../../data/react-query.ts';
import legacyServices, {
  type LegacyData,
  type LegacyInput,
} from './legacyServices.ts';

export const QUERY_KEY_GET_LEGACY = 'QUERY_KEY_GET_LEGACY';

const invalidate = () =>
  void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_GET_LEGACY] });

export function useGetLegacy() {
  return useQuery({
    queryKey: [QUERY_KEY_GET_LEGACY],
    queryFn: async () => (await legacyServices.getLegacy()).data,
    // The print page must show the loans and balances as they are now
    refetchOnMount: 'always',
  });
}

export function useCreateLegacyEntry() {
  return useMutation({
    mutationFn: async (input: LegacyInput) =>
      (await legacyServices.createEntry(input)).data,
    onSuccess: invalidate,
  });
}

export function useUpdateLegacyEntry() {
  return useMutation({
    mutationFn: async (input: { id: string; data: LegacyData }) =>
      (await legacyServices.updateEntry(input.id, input.data)).data,
    onSuccess: invalidate,
  });
}

export function useDeleteLegacyEntry() {
  return useMutation({
    mutationFn: async (id: string) =>
      (await legacyServices.deleteEntry(id)).data,
    onSuccess: invalidate,
  });
}
