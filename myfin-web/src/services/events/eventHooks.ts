import { useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../../data/react-query.ts';
import eventServices, { EventInput } from './eventServices.ts';

export const QUERY_KEY_GET_EVENTS = 'QUERY_KEY_GET_EVENTS';
export const QUERY_KEY_GET_UPCOMING = 'QUERY_KEY_GET_UPCOMING';
export const QUERY_KEY_GET_EVENT_SUGGESTIONS =
  'QUERY_KEY_GET_EVENT_SUGGESTIONS';

/** Events and Upcoming read transactions and tags (auto-match, gift spend): refresh them when those change. */
export function invalidateEventQueries() {
  for (const key of [
    QUERY_KEY_GET_EVENTS,
    QUERY_KEY_GET_UPCOMING,
    QUERY_KEY_GET_EVENT_SUGGESTIONS,
  ])
    void queryClient.invalidateQueries({ queryKey: [key] });
}

const invalidateAll = invalidateEventQueries;

export function useGetEvents() {
  return useQuery({
    queryKey: [QUERY_KEY_GET_EVENTS],
    queryFn: async () => (await eventServices.getEvents()).data,
  });
}

export function useGetUpcoming(days = 30) {
  return useQuery({
    queryKey: [QUERY_KEY_GET_UPCOMING, days],
    queryFn: async () => (await eventServices.getUpcoming(days)).data,
  });
}

export function useGetEventSuggestions() {
  return useQuery({
    queryKey: [QUERY_KEY_GET_EVENT_SUGGESTIONS],
    queryFn: async () => (await eventServices.getSuggestions()).data,
  });
}

export function useSaveEvent() {
  return useMutation({
    mutationFn: async (input: { id: string | null; data: EventInput }) =>
      (input.id === null
        ? await eventServices.createEvent(input.data)
        : await eventServices.updateEvent(input.id, input.data)
      ).data,
    onSuccess: invalidateAll,
  });
}

export function useDeleteEvent() {
  return useMutation({
    mutationFn: async (id: string) =>
      (await eventServices.deleteEvent(id)).data,
    onSuccess: invalidateAll,
  });
}

export function useSetOccurrenceDone() {
  return useMutation({
    mutationFn: async (input: {
      eventId: string;
      date: string;
      done: boolean;
    }) =>
      (await eventServices.setDone(input.eventId, input.date, input.done)).data,
    onSuccess: invalidateAll,
  });
}

export function useLinkEventTransaction() {
  return useMutation({
    mutationFn: async (input: {
      eventId: string;
      date: string;
      transactionId: string;
    }) =>
      (
        await eventServices.linkTransaction(
          input.eventId,
          input.date,
          input.transactionId,
        )
      ).data,
    onSuccess: invalidateAll,
  });
}

export function useUnlinkEventTransaction() {
  return useMutation({
    mutationFn: async (input: {
      eventId: string;
      date: string;
      transactionId: string;
    }) =>
      (
        await eventServices.unlinkTransaction(
          input.eventId,
          input.date,
          input.transactionId,
        )
      ).data,
    onSuccess: invalidateAll,
  });
}

export function useDismissEventSuggestion() {
  return useMutation({
    mutationFn: async (key: string) =>
      (await eventServices.dismissSuggestion(key)).data,
    onSuccess: invalidateAll,
  });
}
