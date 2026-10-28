import { axios } from '../../data/axios.ts';

export const PEOPLE_KINDS = ['birthday', 'anniversary', 'wedding'] as const;
export const MONEY_KINDS = [
  'rent',
  'card_due',
  'renewal',
  'sip',
  'other',
] as const;
export const EVENT_KINDS = [...PEOPLE_KINDS, ...MONEY_KINDS] as const;
export const EVENT_REPEATS = ['once', 'monthly', 'yearly'] as const;

export type EventKind = (typeof EVENT_KINDS)[number];
export type EventRepeat = (typeof EVENT_REPEATS)[number];

export const isPeopleKind = (kind: string) =>
  (PEOPLE_KINDS as readonly string[]).includes(kind);

export type LinkedTransaction = {
  transaction_id: string;
  description: string;
  amount: number;
  date: number;
};

export type EventOccurrence = {
  event_id: string;
  date: string;
  days_until: number;
  status: 'pending' | 'done';
  done_at: number | null;
  gift_spent: number | null;
  transactions: string[];
  linked: LinkedTransaction[];
};

export type MyFinEvent = {
  event_id: string;
  name: string;
  kind: EventKind;
  date: string;
  repeat: EventRepeat;
  amount: number | null;
  gift_budget: number | null;
  account_id: string | null;
  category_id: string | null;
  payee_key: string | null;
  tag_id: string | null;
  tag_name: string | null;
  source_key: string | null;
  active: boolean;
  last_occurrence: EventOccurrence | null;
  next_occurrence: EventOccurrence | null;
  suggested_gift_budget: number | null;
  history: EventOccurrence[];
};

export type EventInput = {
  name: string;
  kind: EventKind;
  date: string;
  repeat: EventRepeat;
  amount: number | null;
  gift_budget: number | null;
  account_id: number | null;
  category_id: number | null;
  payee_key: string | null;
  active?: boolean;
  /** Accepting a suggestion (create only). */
  source_key?: string | null;
};

export type UpcomingItem = {
  source: 'event' | 'emi';
  id: string;
  name: string;
  kind: string;
  date: string;
  days_until: number;
  amount: number | null;
  status: 'pending' | 'done';
  gift_budget: number | null;
  gift_spent: number | null;
  transactions: string[];
};

export type EventSuggestion = {
  key: string;
  name: string;
  kind: EventKind;
  date: string;
  repeat: EventRepeat;
  amount: number | null;
  category_id: string | null;
  payee_key: string | null;
  account_id: string | null;
};

const getEvents = () => axios.get<MyFinEvent[]>('/events');
const createEvent = (input: EventInput) =>
  axios.post<MyFinEvent>('/events', input);
const updateEvent = (id: string, input: EventInput) =>
  axios.put<MyFinEvent>(`/events/${id}`, input);
const deleteEvent = (id: string) => axios.delete<{ ok: true }>(`/events/${id}`);
const getUpcoming = (days: number) =>
  axios.get<UpcomingItem[]>('/events/upcoming', { params: { days } });
const setDone = (eventId: string, date: string, done: boolean) =>
  axios.post<EventOccurrence>(`/events/occurrences/${eventId}/${date}/done`, {
    done,
  });
const linkTransaction = (
  eventId: string,
  date: string,
  transactionId: string,
) =>
  axios.post<EventOccurrence>(`/events/occurrences/${eventId}/${date}/link`, {
    transaction_id: Number(transactionId),
  });
const unlinkTransaction = (
  eventId: string,
  date: string,
  transactionId: string,
) =>
  axios.delete<EventOccurrence>(
    `/events/occurrences/${eventId}/${date}/link/${transactionId}`,
  );
const getSuggestions = () =>
  axios.get<EventSuggestion[]>('/events/suggestions');
const dismissSuggestion = (key: string) =>
  axios.post<{ ok: true }>('/events/suggestions/dismiss', { key });

export default {
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  getUpcoming,
  setDone,
  linkTransaction,
  unlinkTransaction,
  getSuggestions,
  dismissSuggestion,
};
