import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import { MYFIN } from '../../consts.js';
import APIError from '../../errorHandling/apiError.js';
import ConvertUtils from '../../utils/convertUtils.js';
import { listLoans } from '../debts/loanService.js';
import { countsForAnalyticsSql } from '../insights/analyticsRules.js';
import { dayStartIST, monthRangeIST, payeeKeySql, shiftMonth } from '../insights/insightsPrimitives.js';
import { ownershipSql } from '../insights/typicalMonth.js';
import TagService from '../tagService.js';
import {
  EVENT_KINDS,
  EVENT_REPEATS,
  PEOPLE_KINDS,
  addDays,
  clampedDate,
  daysBetween,
  isOccurrence,
  istDate,
  lastOccurrenceOnOrBefore,
  nextOccurrenceOnOrAfter,
  occurrencesBetween,
} from './eventDates.js';
import { monthOfIST } from './monthlyRecordService.js';

export { occurrencesBetween };

/**
 * Event reminders (#6): people events (birthday, anniversary, wedding) with a gift budget tracked
 * through an `event:<name>` tag and linked transactions, and money events (rent, card due, renewal,
 * SIP, other) that are marked paid when the matching payment appears. Occurrence rows are created on
 * demand: when an occurrence is marked done, linked, or auto-matched. Dates are IST calendar days.
 */

export { EVENT_KINDS, EVENT_REPEATS, PEOPLE_KINDS };
export const TAG_PREFIX = 'event:';
/** The longest event name whose tag still fits tags.name (VarChar 255). */
export const MAX_EVENT_NAME = 255 - TAG_PREFIX.length;

const MATCH_DAYS = 5;
const AMOUNT_TOLERANCE = 0.1;
const GIFT_DAYS_BEFORE = 60;
const GIFT_DAYS_AFTER = 7;
const AUTO_MATCH_BACK_DAYS = 35;
const LIST_AHEAD_DAYS = 30;
const SUGGESTION_MONTHS = 4;
const HISTORY_DAYS = 365;
const HISTORY_MAX = 6;

const isPeople = (kind: string) => PEOPLE_KINDS.includes(kind);

type EventRow = Prisma.eventsGetPayload<object>;
type Db = Prisma.TransactionClient | typeof prisma;

export type EventInput = {
  name: string;
  kind: string;
  /** YYYY-MM-DD, the first occurrence. */
  date: string;
  repeat: string;
  /** Currency. */
  amount?: number | null;
  /** Currency. */
  gift_budget?: number | null;
  account_id?: number | string | bigint | null;
  category_id?: number | string | bigint | null;
  payee_key?: string | null;
  /** The suggestion key this event is accepted from (create only). */
  source_key?: string | null;
  active?: boolean;
};

export type LinkedTransaction = { transaction_id: string; description: string; amount: number; date: number };

export type Occurrence = {
  event_id: string;
  date: string;
  days_until: number;
  status: 'pending' | 'done';
  done_at: number | null;
  /** People events: Σ tagged spend near the occurrence plus linked transactions. Null otherwise. */
  gift_spent: number | null;
  transactions: string[];
  linked: LinkedTransaction[];
};

export type EventDto = {
  event_id: string;
  name: string;
  kind: string;
  date: string;
  repeat: string;
  amount: number | null;
  gift_budget: number | null;
  account_id: string | null;
  category_id: string | null;
  payee_key: string | null;
  tag_id: string | null;
  tag_name: string | null;
  source_key: string | null;
  active: boolean;
  last_occurrence: Occurrence | null;
  next_occurrence: Occurrence | null;
  /** People events: the last occurrence's actual spend, as next time's budget. */
  suggested_gift_budget: number | null;
  /** Past occurrences of the last year, newest first (at most 6). */
  history: Occurrence[];
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
  kind: string;
  date: string;
  repeat: string;
  amount: number | null;
  category_id: string | null;
  payee_key: string | null;
  account_id: string | null;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);
const currency = (c: bigint | number) => ConvertUtils.convertBigIntegerToFloat(BigInt(c));
const cents = (v: number) => ConvertUtils.convertFloatToBigInteger(v);
const idStr = (v: bigint | null | undefined) => (v == null ? null : v.toString());
const toBigOrNull = (v: number | string | bigint | null | undefined) => (v == null || v === '' ? null : BigInt(v));
const isP2002 = (err: unknown) => (err as { code?: string })?.code === 'P2002';
const occKey = (eventId: bigint | string, date: string) => `${eventId}|${date}`;

/** Same normalisation as `payeeKeySql`, so an event's payee key compares equal to a row's. */
export function normalizePayeeKey(v: string | null | undefined): string | null {
  if (v == null) return null;
  const key = v
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .replace(/^(PAID TO|RECEIVED FROM|REQUESTED BY|PAYMENT TO) /, '');
  return key.length ? key.slice(0, 255) : null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

async function ownedEvent(userId: bigint, eventId: bigint, db: Db = prisma): Promise<EventRow> {
  const event = await db.events.findFirst({ where: { event_id: eventId, users_user_id: userId } });
  if (!event) throw APIError.notAuthorized();
  return event;
}

async function validated(userId: bigint, input: EventInput) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length === 0 || name.length > MAX_EVENT_NAME)
    throw APIError.badRequest(`The name must have 1 to ${MAX_EVENT_NAME} characters.`);
  if (!(EVENT_KINDS as readonly string[]).includes(input.kind)) throw APIError.badRequest('Unknown event kind.');
  if (!(EVENT_REPEATS as readonly string[]).includes(input.repeat)) throw APIError.badRequest('Unknown repeat.');
  if (dayStartIST(input.date) == null) throw APIError.badRequest('The date must be a real YYYY-MM-DD date.');
  for (const v of [input.amount, input.gift_budget])
    if (v != null && !(Number.isFinite(v) && v >= 0)) throw APIError.badRequest('Amounts must be zero or more.');
  const accountId = toBigOrNull(input.account_id);
  if (accountId != null) {
    const acc = await prisma.accounts.findFirst({ where: { account_id: accountId, users_user_id: userId } });
    if (!acc) throw APIError.badRequest('Account does not belong to this user.');
  }
  const categoryId = toBigOrNull(input.category_id);
  if (categoryId != null) {
    const cat = await prisma.categories.findFirst({ where: { category_id: categoryId, users_user_id: userId } });
    if (!cat) throw APIError.badRequest('Category does not belong to this user.');
  }
  return {
    name,
    kind: input.kind,
    date: input.date,
    repeat: input.repeat,
    amount: input.amount != null ? cents(input.amount) : null,
    gift_budget: input.gift_budget != null ? cents(input.gift_budget) : null,
    account_id: accountId,
    category_id: categoryId,
    payee_key: normalizePayeeKey(input.payee_key),
  };
}

/** The tag `event:<name>`: reused when it exists and no other event uses it, else created. */
async function tagFor(userId: bigint, name: string, eventId: bigint | null, db: Db): Promise<bigint> {
  const tagName = `${TAG_PREFIX}${name}`;
  const existing = await db.tags.findFirst({ where: { users_user_id: userId, name: tagName } });
  if (existing) {
    const other = await db.events.findFirst({
      where: { tag_id: existing.tag_id, ...(eventId != null ? { NOT: { event_id: eventId } } : {}) },
      select: { event_id: true },
    });
    if (other) throw APIError.badRequest('An event with this name already exists.');
    return existing.tag_id;
  }
  const created = await TagService.createTag({ users_user_id: userId, name: tagName, description: '' }, db as typeof prisma);
  return created.tag_id;
}

const duplicate = (err: unknown) =>
  isP2002(err) ? APIError.badRequest('An event with this name or suggestion already exists.') : err;

export async function createEvent(userId: bigint, input: EventInput, now: number = nowSeconds()): Promise<EventDto> {
  const data = await validated(userId, input);
  const sourceKey = typeof input.source_key === 'string' && input.source_key.length ? input.source_key.slice(0, 255) : null;
  try {
    const row = await prisma.$transaction(async (tx) => {
      const tagId = await tagFor(userId, data.name, null, tx);
      return tx.events.create({
        data: {
          ...data,
          users_user_id: userId,
          tag_id: tagId,
          source_key: sourceKey,
          active: input.active ?? true,
          created_at: now,
        },
      });
    });
    return (await toDtos(userId, [row], now))[0];
  } catch (err) {
    throw duplicate(err);
  }
}

/** Renames the event's tag with it (400 when the new tag name is taken). */
export async function updateEvent(
  userId: bigint,
  eventId: bigint,
  input: EventInput,
  now: number = nowSeconds()
): Promise<EventDto> {
  const event = await ownedEvent(userId, eventId);
  const data = await validated(userId, input);
  try {
    const row = await prisma.$transaction(async (tx) => {
      const tag = event.tag_id != null ? await tx.tags.findUnique({ where: { tag_id: event.tag_id } }) : null;
      let tagId = tag?.tag_id ?? null;
      const tagName = `${TAG_PREFIX}${data.name}`;
      if (tag && tag.name !== tagName) {
        const taken = await tx.tags.findFirst({ where: { users_user_id: userId, name: tagName } });
        if (taken) throw APIError.badRequest('An event or tag with this name already exists.');
        await TagService.updateTag(userId, tag.tag_id, { name: tagName }, tx as typeof prisma);
      } else if (!tag) {
        tagId = await tagFor(userId, data.name, eventId, tx);
      }
      return tx.events.update({
        where: { event_id: eventId },
        data: { ...data, tag_id: tagId, ...(input.active === undefined ? {} : { active: input.active }) },
      });
    });
    return (await toDtos(userId, [row], now))[0];
  } catch (err) {
    throw duplicate(err);
  }
}

/** Occurrences and links cascade; the tag stays (it may tag transactions). */
export async function deleteEvent(userId: bigint, eventId: bigint): Promise<void> {
  await ownedEvent(userId, eventId);
  await prisma.events.delete({ where: { event_id: eventId } });
}

type OccurrenceState = { status: 'pending' | 'done'; done_at: number | null; linked: LinkedTransaction[] };

/** Stored occurrence rows of these events, keyed by event and date. */
async function occurrenceStates(eventIds: bigint[], db: Db = prisma): Promise<Map<string, OccurrenceState>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db.event_occurrences.findMany({
    where: { events_event_id: { in: eventIds } },
    include: {
      transactions: {
        include: {
          transaction: { select: { transaction_id: true, description: true, amount: true, date_timestamp: true } },
        },
        orderBy: { transaction_id: 'asc' },
      },
    },
  });
  return new Map(
    rows.map((r) => [
      occKey(r.events_event_id, r.date),
      {
        status: r.status === 'done' ? 'done' : 'pending',
        done_at: r.done_at != null ? Number(r.done_at) : null,
        linked: r.transactions.map((l) => ({
          transaction_id: l.transaction.transaction_id.toString(),
          description: l.transaction.description ?? '',
          amount: currency(l.transaction.amount),
          date: Number(l.transaction.date_timestamp),
        })),
      },
    ])
  );
}

/**
 * Gift spend of a people occurrence, in cents: counted expenses tagged with the event's tag dated
 * within [occurrence − 60 days, occurrence + 7 days], plus linked transactions, each counted once.
 */
async function giftSpentCents(userId: bigint, tagId: bigint | null, date: string, linked: string[]): Promise<number> {
  if (tagId == null && linked.length === 0) return 0;
  const from = dayStartIST(addDays(date, -GIFT_DAYS_BEFORE)) as number;
  const to = dayStartIST(addDays(date, GIFT_DAYS_AFTER + 1)) as number;
  const tagged =
    tagId == null
      ? Prisma.sql`FALSE`
      : Prisma.sql`(transactions.type = ${MYFIN.TRX_TYPES.EXPENSE} AND ${countsForAnalyticsSql}
          AND transactions.date_timestamp >= ${from} AND transactions.date_timestamp < ${to}
          AND EXISTS (SELECT 1 FROM transaction_has_tags tht
                      WHERE tht.transactions_transaction_id = transactions.transaction_id AND tht.tags_tag_id = ${tagId}))`;
  const links = linked.length
    ? Prisma.sql`transactions.transaction_id IN (${Prisma.join(linked.map((id) => BigInt(id)))})`
    : Prisma.sql`FALSE`;
  const [row] = await prisma.$queryRaw<{ total: unknown }[]>`
    SELECT COALESCE(SUM(transactions.amount), 0) AS total
    ${ownershipSql(userId)}
      AND (${tagged} OR ${links})`;
  return Number(row?.total ?? 0);
}

async function occurrence(
  userId: bigint,
  event: EventRow,
  date: string,
  states: Map<string, OccurrenceState>,
  today: string
): Promise<Occurrence> {
  const st = states.get(occKey(event.event_id, date));
  const linked = st?.linked ?? [];
  const transactions = linked.map((l) => l.transaction_id);
  return {
    event_id: event.event_id.toString(),
    date,
    days_until: daysBetween(today, date),
    status: st?.status ?? 'pending',
    done_at: st?.done_at ?? null,
    gift_spent: isPeople(event.kind) ? (await giftSpentCents(userId, event.tag_id, date, transactions)) / 100 : null,
    transactions,
    linked,
  };
}

async function toDtos(userId: bigint, rows: EventRow[], now: number): Promise<EventDto[]> {
  const today = istDate(now);
  const states = await occurrenceStates(rows.map((r) => r.event_id));
  const tagIds = rows.map((r) => r.tag_id).filter((t): t is bigint => t != null);
  const tags = tagIds.length
    ? await prisma.tags.findMany({ where: { tag_id: { in: tagIds } }, select: { tag_id: true, name: true } })
    : [];
  const tagName = new Map(tags.map((t) => [t.tag_id.toString(), t.name]));
  const out: EventDto[] = [];
  for (const e of rows) {
    const yesterday = addDays(today, -1);
    const pastDates = occurrencesBetween(e, addDays(today, -HISTORY_DAYS), yesterday).slice(-HISTORY_MAX).reverse();
    const history: Occurrence[] = [];
    for (const d of pastDates) history.push(await occurrence(userId, e, d, states, today));
    const lastDate = pastDates[0] ?? lastOccurrenceOnOrBefore(e, yesterday);
    const last = lastDate
      ? (history.find((h) => h.date === lastDate) ?? (await occurrence(userId, e, lastDate, states, today)))
      : null;
    const nextDate = nextOccurrenceOnOrAfter(e, today);
    const next = nextDate ? await occurrence(userId, e, nextDate, states, today) : null;
    out.push({
      event_id: e.event_id.toString(),
      name: e.name,
      kind: e.kind,
      date: e.date,
      repeat: e.repeat,
      amount: e.amount != null ? currency(e.amount) : null,
      gift_budget: e.gift_budget != null ? currency(e.gift_budget) : null,
      account_id: idStr(e.account_id),
      category_id: idStr(e.category_id),
      payee_key: e.payee_key,
      tag_id: idStr(e.tag_id),
      tag_name: e.tag_id != null ? (tagName.get(e.tag_id.toString()) ?? null) : null,
      source_key: e.source_key,
      active: e.active,
      last_occurrence: last,
      next_occurrence: next,
      suggested_gift_budget: isPeople(e.kind) && last?.gift_spent ? last.gift_spent : null,
      history,
    });
  }
  return out;
}

type MatchCandidate = {
  transaction_id: bigint;
  type: string;
  amount: bigint;
  date_timestamp: bigint;
  category_id: bigint | null;
  account_to_id: bigint | null;
  payee_key: string | null;
};

function matchesEvent(e: EventRow, c: MatchCandidate): boolean {
  const byPayee = e.payee_key != null && c.payee_key === e.payee_key;
  const byCategory = e.category_id != null && c.category_id === e.category_id;
  const byAccount =
    e.kind === 'card_due' &&
    e.account_id != null &&
    c.type === MYFIN.TRX_TYPES.TRANSFER &&
    c.account_to_id === e.account_id;
  if (!byPayee && !byCategory && !byAccount) return false;
  if (e.amount != null) {
    const target = Number(e.amount);
    if (Math.abs(Number(c.amount) - target) > target * AMOUNT_TOLERANCE) return false;
  }
  return true;
}

/**
 * Auto-match (money kinds, on read; idempotent): each occurrence in [fromDate, toDate] that has no
 * stored row yet takes the closest-dated unlinked counted expense or transfer within ±5 days that
 * matches the event's payee key or category (or, for a card due, a transfer into its account), and
 * within ±10 % of the event's amount when it has one. The occurrence is then done. An occurrence the
 * user has touched (marked, linked or unlinked) has a row and is left alone. The unique constraint on
 * the link's transaction id keeps a transaction from marking two occurrences.
 */
async function autoMatch(userId: bigint, fromDate: string, toDate: string, now: number): Promise<void> {
  const events = (
    await prisma.events.findMany({
      where: { users_user_id: userId, active: true, kind: { notIn: [...PEOPLE_KINDS] } },
      orderBy: { event_id: 'asc' },
    })
  ).filter((e) => e.payee_key != null || e.category_id != null || (e.kind === 'card_due' && e.account_id != null));
  if (events.length === 0) return;
  const stored = await prisma.event_occurrences.findMany({
    where: { events_event_id: { in: events.map((e) => e.event_id) }, date: { gte: fromDate, lte: toDate } },
    select: { events_event_id: true, date: true },
  });
  const hasRow = new Set(stored.map((r) => occKey(r.events_event_id, r.date)));
  const pending = events
    .flatMap((e) => occurrencesBetween(e, fromDate, toDate).map((date) => ({ e, date })))
    .filter((p) => !hasRow.has(occKey(p.e.event_id, p.date)))
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.e.event_id - b.e.event_id));
  if (pending.length === 0) return;
  const from = dayStartIST(addDays(fromDate, -MATCH_DAYS)) as number;
  const to = dayStartIST(addDays(toDate, MATCH_DAYS + 1)) as number;
  const candidates = await prisma.$queryRaw<MatchCandidate[]>`
    SELECT transactions.transaction_id,
           transactions.type,
           transactions.amount,
           transactions.date_timestamp,
           transactions.categories_category_id AS category_id,
           transactions.accounts_account_to_id AS account_to_id,
           ${payeeKeySql} AS payee_key
    ${ownershipSql(userId)}
      AND transactions.date_timestamp >= ${from} AND transactions.date_timestamp < ${to}
      AND ((transactions.type = ${MYFIN.TRX_TYPES.EXPENSE} AND ${countsForAnalyticsSql})
        OR (transactions.type = ${MYFIN.TRX_TYPES.TRANSFER} AND transactions.is_adjustment = false AND transactions.debt_role IS NULL))
      AND NOT EXISTS (SELECT 1 FROM event_occurrence_transactions eot WHERE eot.transaction_id = transactions.transaction_id)`;
  const used = new Set<string>();
  for (const { e, date } of pending) {
    let best: { c: MatchCandidate; gap: number } | null = null;
    for (const c of candidates) {
      if (used.has(c.transaction_id.toString()) || !matchesEvent(e, c)) continue;
      const gap = Math.abs(daysBetween(date, istDate(Number(c.date_timestamp))));
      if (gap > MATCH_DAYS) continue;
      if (!best || gap < best.gap || (gap === best.gap && c.transaction_id < best.c.transaction_id)) best = { c, gap };
    }
    if (!best) continue;
    used.add(best.c.transaction_id.toString());
    const transactionId = best.c.transaction_id;
    try {
      await prisma.$transaction(async (tx) => {
        const occ = await tx.event_occurrences.create({
          data: { events_event_id: e.event_id, date, status: 'done', done_at: now },
        });
        await tx.event_occurrence_transactions.create({
          data: { occurrence_id: occ.occurrence_id, transaction_id: transactionId },
        });
      });
    } catch (err) {
      // A concurrent read created the occurrence or claimed the transaction first
      if (!isP2002(err)) throw err;
    }
  }
}

export async function listEvents(userId: bigint, now: number = nowSeconds()): Promise<EventDto[]> {
  const today = istDate(now);
  await autoMatch(userId, addDays(today, -AUTO_MATCH_BACK_DAYS), addDays(today, LIST_AHEAD_DAYS), now);
  const rows = await prisma.events.findMany({
    where: { users_user_id: userId },
    orderBy: [{ name: 'asc' }, { event_id: 'asc' }],
  });
  return toDtos(userId, rows, now);
}

/** Active events' occurrences and unpaid loan EMIs due in [today, today + days] (IST), by date. */
export async function upcoming(userId: bigint, days: number, now: number = nowSeconds()): Promise<UpcomingItem[]> {
  const today = istDate(now);
  const end = addDays(today, days);
  await autoMatch(userId, addDays(today, -AUTO_MATCH_BACK_DAYS), end, now);
  const events = await prisma.events.findMany({ where: { users_user_id: userId, active: true } });
  const states = await occurrenceStates(events.map((e) => e.event_id));
  const items: UpcomingItem[] = [];
  for (const e of events) {
    for (const date of occurrencesBetween(e, today, end)) {
      const occ = await occurrence(userId, e, date, states, today);
      items.push({
        source: 'event',
        id: e.event_id.toString(),
        name: e.name,
        kind: e.kind,
        date,
        days_until: occ.days_until,
        amount: e.amount != null ? currency(e.amount) : null,
        status: occ.status,
        gift_budget: isPeople(e.kind) && e.gift_budget != null ? currency(e.gift_budget) : null,
        gift_spent: occ.gift_spent,
        transactions: occ.transactions,
      });
    }
  }
  for (const loan of await listLoans(userId, now)) {
    if (loan.status !== 'open') continue;
    for (const r of loan.schedule) {
      if (r.status === 'paid' || r.date < today || r.date > end) continue;
      items.push({
        source: 'emi',
        id: `${loan.debt_id}:${r.n}`,
        name: loan.lender,
        kind: 'emi',
        date: r.date,
        days_until: daysBetween(today, r.date),
        amount: r.emi,
        status: 'pending',
        gift_budget: null,
        gift_spent: null,
        transactions: [],
      });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

async function assertOccurrence(event: EventRow, date: string) {
  if (dayStartIST(date) == null || !isOccurrence(event, date))
    throw APIError.badRequest('This date is not an occurrence of the event.');
}

/** The occurrence row, created when missing (INSERT IGNORE, so concurrent callers share one row). */
async function ensureOccurrence(tx: Prisma.TransactionClient, eventId: bigint, date: string) {
  await tx.event_occurrences.createMany({ data: [{ events_event_id: eventId, date }], skipDuplicates: true });
  return tx.event_occurrences.findUniqueOrThrow({ where: { events_event_id_date: { events_event_id: eventId, date } } });
}

async function occurrenceOf(userId: bigint, event: EventRow, date: string, now: number): Promise<Occurrence> {
  return occurrence(userId, event, date, await occurrenceStates([event.event_id]), istDate(now));
}

/** Manual done / undone; works for any event. */
export async function setOccurrenceDone(
  userId: bigint,
  eventId: bigint,
  date: string,
  done: boolean,
  now: number = nowSeconds()
): Promise<Occurrence> {
  const event = await ownedEvent(userId, eventId);
  await assertOccurrence(event, date);
  await prisma.$transaction(async (tx) => {
    const occ = await ensureOccurrence(tx, eventId, date);
    await tx.event_occurrences.update({
      where: { occurrence_id: occ.occurrence_id },
      data: { status: done ? 'done' : 'pending', done_at: done ? now : null },
    });
  });
  return occurrenceOf(userId, event, date, now);
}

/** Links one of the user's expenses or transfers to an occurrence; a money occurrence becomes done. */
export async function linkTransaction(
  userId: bigint,
  eventId: bigint,
  date: string,
  transactionId: bigint,
  now: number = nowSeconds()
): Promise<Occurrence> {
  const event = await ownedEvent(userId, eventId);
  await assertOccurrence(event, date);
  const trx = await prisma.transactions.findFirst({
    where: {
      transaction_id: transactionId,
      OR: [
        { accounts_transactions_accounts_account_from_idToaccounts: { users_user_id: userId } },
        { accounts_transactions_accounts_account_to_idToaccounts: { users_user_id: userId } },
      ],
    },
    select: { type: true },
  });
  if (!trx) throw APIError.notAuthorized();
  if (trx.type !== MYFIN.TRX_TYPES.EXPENSE && trx.type !== MYFIN.TRX_TYPES.TRANSFER)
    throw APIError.badRequest('Only expenses and transfers can be linked to an event.');
  const alreadyLinked = APIError.badRequest('This transaction is already linked to an event.');
  try {
    await prisma.$transaction(async (tx) => {
      const occ = await ensureOccurrence(tx, eventId, date);
      if (await tx.event_occurrence_transactions.findUnique({ where: { transaction_id: transactionId } }))
        throw alreadyLinked;
      await tx.event_occurrence_transactions.create({
        data: { occurrence_id: occ.occurrence_id, transaction_id: transactionId },
      });
      if (!isPeople(event.kind))
        await tx.event_occurrences.update({
          where: { occurrence_id: occ.occurrence_id },
          data: { status: 'done', done_at: now },
        });
    });
  } catch (err) {
    if (isP2002(err)) throw alreadyLinked;
    throw err;
  }
  return occurrenceOf(userId, event, date, now);
}

/** Unlinks; a money occurrence left without links goes back to pending (and is not auto-matched again). */
export async function unlinkTransaction(
  userId: bigint,
  eventId: bigint,
  date: string,
  transactionId: bigint,
  now: number = nowSeconds()
): Promise<Occurrence> {
  const event = await ownedEvent(userId, eventId);
  await prisma.$transaction(async (tx) => {
    const occ = await tx.event_occurrences.findUnique({
      where: { events_event_id_date: { events_event_id: eventId, date } },
    });
    const removed = occ
      ? await tx.event_occurrence_transactions.deleteMany({
          where: { occurrence_id: occ.occurrence_id, transaction_id: transactionId },
        })
      : { count: 0 };
    if (!occ || removed.count === 0) throw APIError.badRequest('This transaction is not linked to this occurrence.');
    const left = await tx.event_occurrence_transactions.count({ where: { occurrence_id: occ.occurrence_id } });
    if (!isPeople(event.kind) && left === 0)
      await tx.event_occurrences.update({
        where: { occurrence_id: occ.occurrence_id },
        data: { status: 'pending', done_at: null },
      });
  });
  return occurrenceOf(userId, event, date, now);
}

/** The first day on or after `today` that is day `day` of a month (clamped to the month's end). */
function nextMonthlyDate(today: string, day: number): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const thisMonth = clampedDate(y, m, day);
  if (thisMonth >= today) return thisMonth;
  return m === 12 ? clampedDate(y + 1, 1, day) : clampedDate(y, m + 1, day);
}

const dayOfMonth = (epoch: number) => Number(istDate(epoch).slice(8, 10));

/**
 * Suggested money events: active yearly costs at their due month (day 1); payees with counted
 * expenses in ≥ 3 of the last 4 months on days of the month within 3 of each other (monthly, on the
 * median day); and credit-card accounts with ≥ 2 transfers in over the last 4 months (card due,
 * monthly, on the median day). Dismissed keys and keys of existing events are left out.
 */
export async function suggestions(userId: bigint, now: number = nowSeconds()): Promise<EventSuggestion[]> {
  const today = istDate(now);
  const cur = monthOfIST(now);
  const [dismissals, events] = await Promise.all([
    prisma.event_suggestion_dismissals.findMany({ where: { users_user_id: userId }, select: { key: true } }),
    prisma.events.findMany({
      where: { users_user_id: userId },
      select: { source_key: true, payee_key: true, account_id: true, kind: true },
    }),
  ]);
  const taken = new Set<string>([
    ...dismissals.map((d) => d.key),
    ...events.map((e) => e.source_key).filter((k): k is string => k != null),
  ]);
  const eventPayees = new Set(events.map((e) => e.payee_key).filter((k): k is string => k != null));
  const eventCards = new Set(events.filter((e) => e.kind === 'card_due' && e.account_id != null).map((e) => String(e.account_id)));
  const out: EventSuggestion[] = [];

  // Yearly costs at their due month
  const costs = await prisma.yearly_costs.findMany({
    where: { users_user_id: userId, active: true },
    orderBy: { yearly_cost_id: 'asc' },
  });
  for (const c of costs) {
    const key = `yearly:${c.yearly_cost_id}`;
    if (taken.has(key)) continue;
    const thisYear = clampedDate(cur.year, c.due_month, 1);
    out.push({
      key,
      name: c.name,
      kind: 'renewal',
      date: thisYear >= today ? thisYear : clampedDate(cur.year + 1, c.due_month, 1),
      repeat: 'yearly',
      amount: currency(c.amount),
      category_id: idStr(c.category_id),
      payee_key: null,
      account_id: null,
    });
  }

  const from = monthRangeIST(shiftMonth(cur, -(SUGGESTION_MONTHS - 1))).from;
  const to = monthRangeIST(cur).to;

  // Payments recurring on about the same day each month
  const rows = await prisma.$queryRaw<
    { amount: bigint; date_timestamp: bigint; category_id: bigint | null; payee_key: string | null }[]
  >`
    SELECT transactions.amount,
           transactions.date_timestamp,
           transactions.categories_category_id AS category_id,
           ${payeeKeySql} AS payee_key
    ${ownershipSql(userId)}
      AND transactions.type = ${MYFIN.TRX_TYPES.EXPENSE}
      AND ${countsForAnalyticsSql}
      AND transactions.debt_id IS NULL
      AND transactions.date_timestamp >= ${from} AND transactions.date_timestamp < ${to}`;
  const byPayee = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.payee_key) continue;
    byPayee.set(r.payee_key, [...(byPayee.get(r.payee_key) ?? []), r]);
  }
  for (const [payee, list] of byPayee) {
    const key = `recurring:${payee}`.slice(0, 255);
    if (taken.has(key) || eventPayees.has(payee)) continue;
    const months = new Set(list.map((r) => istDate(Number(r.date_timestamp)).slice(0, 7)));
    const days = list.map((r) => dayOfMonth(Number(r.date_timestamp)));
    if (months.size < 3 || Math.max(...days) - Math.min(...days) > 3) continue;
    const catCount = new Map<string, number>();
    for (const r of list) if (r.category_id != null) catCount.set(String(r.category_id), (catCount.get(String(r.category_id)) ?? 0) + 1);
    const category = [...catCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    out.push({
      key,
      name: payee,
      kind: 'other',
      date: nextMonthlyDate(today, Math.round(median(days))),
      repeat: 'monthly',
      amount: Math.round(median(list.map((r) => Number(r.amount)))) / 100,
      category_id: category,
      payee_key: payee,
      account_id: null,
    });
  }

  // Credit-card due dates
  const cards = await prisma.accounts.findMany({
    where: { users_user_id: userId, type: MYFIN.ACCOUNT_TYPES.CREDIT, status: MYFIN.ACCOUNT_STATUS.ACTIVE },
    select: { account_id: true, name: true },
    orderBy: { account_id: 'asc' },
  });
  if (cards.length) {
    const payments = await prisma.transactions.findMany({
      where: {
        type: MYFIN.TRX_TYPES.TRANSFER,
        is_adjustment: false,
        accounts_account_to_id: { in: cards.map((c) => c.account_id) },
        date_timestamp: { gte: from, lt: to },
      },
      select: { accounts_account_to_id: true, date_timestamp: true },
    });
    for (const card of cards) {
      const key = `card:${card.account_id}`;
      if (taken.has(key) || eventCards.has(String(card.account_id))) continue;
      const days = payments
        .filter((p) => p.accounts_account_to_id === card.account_id)
        .map((p) => dayOfMonth(Number(p.date_timestamp)));
      if (days.length < 2) continue;
      out.push({
        key,
        name: `${card.name} due`.slice(0, MAX_EVENT_NAME),
        kind: 'card_due',
        date: nextMonthlyDate(today, Math.round(median(days))),
        repeat: 'monthly',
        amount: null,
        category_id: null,
        payee_key: null,
        account_id: card.account_id.toString(),
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

export async function dismissSuggestion(userId: bigint, key: string): Promise<void> {
  await prisma.event_suggestion_dismissals.createMany({
    data: [{ users_user_id: userId, key }],
    skipDuplicates: true,
  });
}

export default {
  occurrencesBetween,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  upcoming,
  setOccurrenceDone,
  linkTransaction,
  unlinkTransaction,
  suggestions,
  dismissSuggestion,
};
