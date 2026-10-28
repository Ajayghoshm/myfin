import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import AccountService from '../../src/services/accountService.js';
import CategoryService from '../../src/services/categoryService.js';
import { createLoan } from '../../src/services/debts/loanService.js';
import { type YearMonth, monthRangeIST } from '../../src/services/insights/insightsPrimitives.js';
import { createYearlyCost } from '../../src/services/planning/yearlyCostService.js';
import {
  createEvent,
  deleteEvent,
  dismissSuggestion,
  linkTransaction,
  listEvents,
  setOccurrenceDone,
  suggestions,
  unlinkTransaction,
  updateEvent,
  upcoming,
} from '../../src/services/routines/eventService.js';
import TagService from '../../src/services/tagService.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';
import BackupManager from '../../src/utils/backupManager.js';
import { expectThrowErrorCode } from './utils/testUtils.js';

const DAY = 86_400;
const E = MYFIN.TRX_TYPES.EXPENSE;
const T = MYFIN.TRX_TYPES.TRANSFER;
const at = (ym: YearMonth, day: number) => monthRangeIST(ym).from + (day - 1) * DAY + 3600;
const ym = (year: number, month: number): YearMonth => ({ year, month });
const NOW = at(ym(2026, 10), 28) + 9 * 3600; // 2026-10-28 10:00 IST

async function setup(username = 'ev') {
  const user = await UserService.createUser({ username, password: '123', email: `${username}@x.com` });
  const uid = user.user_id;
  const account = (name: string, type: string) =>
    AccountService.createAccount(
      {
        name,
        type,
        description: '',
        status: MYFIN.ACCOUNT_STATUS.ACTIVE,
        exclude_from_budgets: false,
        current_balance: 0,
        users_user_id: uid,
      } as never,
      uid
    );
  const bank = await account('Bank', MYFIN.ACCOUNT_TYPES.CHECKING);
  const spend = async (description: string, amount: number, date: number) =>
    BigInt(
      (
        await TransactionService.createTransaction(uid, {
          account_from_id: bank.account_id,
          amount,
          type: E,
          description,
          date_timestamp: date,
          is_essential: false,
        } as never)
      ).transaction_id
    );
  const transfer = async (to: bigint, amount: number, date: number) =>
    BigInt(
      (
        await TransactionService.createTransaction(uid, {
          account_from_id: bank.account_id,
          account_to_id: to,
          amount,
          type: T,
          description: 'Card bill',
          date_timestamp: date,
          is_essential: false,
        } as never)
      ).transaction_id
    );
  const login = await UserService.attemptLogin(username, '123', false);
  const headers = { authusername: username, sessionkey: login.sessionkey, 'content-type': 'application/json' };
  return { uid, bank, account, spend, transfer, headers };
}

const rent = (name = 'Rent') => ({
  name,
  kind: 'rent',
  date: '2026-01-01',
  repeat: 'monthly',
  amount: 15000,
  payee_key: 'RENT CO',
});

describe('event reminders and upcoming', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let server: Server;
  let base: string;
  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(async () => {
    ctx = await setup();
  });

  test('upcoming: a birthday in 5 days and an unpaid EMI, sorted by date', async () => {
    await createEvent(ctx.uid, { name: 'Amma birthday', kind: 'birthday', date: '1965-11-02', repeat: 'yearly', gift_budget: 3000 }, NOW);
    await createEvent(ctx.uid, { name: 'Far away', kind: 'anniversary', date: '2020-12-25', repeat: 'yearly' }, NOW);
    await createEvent(ctx.uid, { name: 'Visa renewal', kind: 'renewal', date: '2026-11-20', repeat: 'once', amount: 500 }, NOW);
    await createEvent(ctx.uid, { name: 'Past once', kind: 'other', date: '2026-10-01', repeat: 'once' }, NOW);
    await createLoan(
      ctx.uid,
      { lender: 'HDFC', principal: 120000, rate: 12, tenure_months: 12, emi_day: 5, account_id: ctx.bank.account_id, start_date: at(ym(2026, 10), 1) },
      NOW
    );
    const items = await upcoming(ctx.uid, 30, NOW);
    expect(items.map((i) => [i.source, i.name, i.date, i.days_until])).toEqual([
      ['event', 'Amma birthday', '2026-11-02', 5],
      ['emi', 'HDFC', '2026-11-05', 8],
      ['event', 'Visa renewal', '2026-11-20', 23],
    ]);
    expect(items[0]).toMatchObject({ kind: 'birthday', status: 'pending', gift_budget: 3000, gift_spent: 0, amount: null });
    expect(items[1]).toMatchObject({ kind: 'emi', status: 'pending', gift_budget: null, gift_spent: null });
    expect(items[1].amount).toBeCloseTo(10661.85, 2);
  });

  test('upcoming: unpaid money items overdue by up to 7 days are included and flagged', async () => {
    const later = at(ym(2026, 11), 8) + 9 * 3600; // 2026-11-08 10:00 IST
    await createEvent(ctx.uid, rent('Rent'), NOW); // 11-01: 7 days overdue
    await createEvent(ctx.uid, rent('Rent paid'), NOW);
    await ctx.spend('Paid to RENT CO', 15000, at(ym(2026, 11), 1)); // claimed by one of the two
    await createEvent(ctx.uid, { name: 'Old', kind: 'renewal', date: '2026-10-31', repeat: 'once', amount: 99 }, NOW); // 8 days
    await createEvent(ctx.uid, { name: 'Amma birthday', kind: 'birthday', date: '1965-11-05', repeat: 'yearly' }, NOW);
    await createLoan(
      ctx.uid,
      { lender: 'HDFC', principal: 120000, rate: 12, tenure_months: 12, emi_day: 5, account_id: ctx.bank.account_id, start_date: at(ym(2026, 10), 1) },
      NOW
    );
    const items = (await upcoming(ctx.uid, 30, later)).filter((i) => i.days_until < 0);
    const unpaid = items.map((i) => [i.source, i.date, i.days_until, i.overdue, i.status]);
    // Exactly one rent occurrence is unpaid (the other is matched); the EMI of 11-05 is unpaid
    expect(unpaid).toEqual([
      ['event', '2026-11-01', -7, true, 'pending'],
      ['emi', '2026-11-05', -3, true, 'pending'],
    ]);
    const future = (await upcoming(ctx.uid, 30, later)).filter((i) => i.days_until >= 0);
    expect(future.every((i) => i.overdue === false)).toBe(true);
  });

  test('upcoming: a card due without an amount shows the card outstanding', async () => {
    const card = await ctx.account('Card 9', MYFIN.ACCOUNT_TYPES.CREDIT);
    await TransactionService.createTransaction(ctx.uid, {
      account_from_id: card.account_id,
      amount: 4321.5,
      type: E,
      description: 'Shop',
      date_timestamp: at(ym(2026, 10), 20),
      is_essential: false,
    } as never);
    await createEvent(ctx.uid, { name: 'Card 9 due', kind: 'card_due', date: '2026-01-15', repeat: 'monthly', account_id: Number(card.account_id) }, NOW);
    await createEvent(ctx.uid, { name: 'Card 9 fixed', kind: 'card_due', date: '2026-01-16', repeat: 'monthly', amount: 500, account_id: Number(card.account_id) }, NOW);
    const items = await upcoming(ctx.uid, 30, NOW);
    expect(items.find((i) => i.name === 'Card 9 due')?.amount).toBeCloseTo(4321.5, 2);
    expect(items.find((i) => i.name === 'Card 9 fixed')?.amount).toBe(500);
  });

  test('gift budget: tagged spend near the occurrence counts; linked + tagged counts once', async () => {
    const ev = await createEvent(ctx.uid, { name: 'Amma birthday', kind: 'birthday', date: '1965-11-02', repeat: 'yearly', gift_budget: 3000 }, NOW);
    const tag = await prisma.tags.findFirstOrThrow({ where: { users_user_id: ctx.uid, name: 'event:Amma birthday' } });
    expect(ev.tag_name).toBe('event:Amma birthday');
    const gift = await ctx.spend('Saree shop', 1200, at(ym(2026, 10), 30));
    const old = await ctx.spend('Old gift', 500, at(ym(2026, 8), 1)); // > 60 days before
    await ctx.spend('Groceries', 800, at(ym(2026, 10), 29)); // untagged
    await TagService.addTagToTransaction(ctx.uid, gift, tag.tag_id);
    await TagService.addTagToTransaction(ctx.uid, old, tag.tag_id);
    let item = (await upcoming(ctx.uid, 30, NOW))[0];
    expect(item).toMatchObject({ gift_budget: 3000, gift_spent: 1200 });
    await linkTransaction(ctx.uid, BigInt(ev.event_id), '2026-11-02', gift, NOW);
    item = (await upcoming(ctx.uid, 30, NOW))[0];
    expect(item).toMatchObject({ gift_spent: 1200, status: 'pending', transactions: [String(gift)] });
    // Next year's suggestion uses the last occurrence's actual spend
    const later = NOW + 10 * DAY;
    const listed = (await listEvents(ctx.uid, later)).find((e) => e.event_id === ev.event_id);
    expect(listed?.last_occurrence?.date).toBe('2026-11-02');
    expect(listed?.suggested_gift_budget).toBe(1200);
    expect(listed?.next_occurrence?.date).toBe('2027-11-02');
  });

  test('tag follows the event name; duplicate names are refused; delete keeps the tag', async () => {
    const ev = await createEvent(ctx.uid, { name: 'Wedding', kind: 'wedding', date: '2026-12-10', repeat: 'once' }, NOW);
    await updateEvent(ctx.uid, BigInt(ev.event_id), { name: 'Anu wedding', kind: 'wedding', date: '2026-12-10', repeat: 'once' });
    const names = async () => (await prisma.tags.findMany({ where: { users_user_id: ctx.uid } })).map((t) => t.name);
    expect(await names()).toEqual(['event:Anu wedding']);
    await createEvent(ctx.uid, { name: 'Other', kind: 'other', date: '2026-12-11', repeat: 'once' }, NOW);
    await expectThrowErrorCode(
      () => updateEvent(ctx.uid, BigInt(ev.event_id), { name: 'Other', kind: 'wedding', date: '2026-12-10', repeat: 'once' }),
      400
    );
    await expectThrowErrorCode(() => createEvent(ctx.uid, { name: 'Other', kind: 'other', date: '2026-12-11', repeat: 'once' }, NOW), 400);
    await deleteEvent(ctx.uid, BigInt(ev.event_id));
    expect((await names()).sort()).toEqual(['event:Anu wedding', 'event:Other']);
    // Re-creating the deleted event reuses its tag
    const again = await createEvent(ctx.uid, { name: 'Anu wedding', kind: 'wedding', date: '2026-12-10', repeat: 'once' }, NOW);
    expect(again.tag_name).toBe('event:Anu wedding');
  });

  test('auto-match: rent paid on 11-03 marks 11-01 done; a second rent event cannot claim it', async () => {
    const a = await createEvent(ctx.uid, rent('Rent A'), NOW);
    const b = await createEvent(ctx.uid, rent('Rent B'), NOW);
    await ctx.spend('Paid to RENT CO', 20000, at(ym(2026, 11), 2)); // > 10 % off
    const paid = await ctx.spend('Paid to RENT CO', 15200, at(ym(2026, 11), 3));
    for (let i = 0; i < 2; i++) {
      const items = await upcoming(ctx.uid, 30, NOW);
      const byName = Object.fromEntries(items.map((x) => [x.name, x]));
      expect(byName['Rent A']).toMatchObject({ date: '2026-11-01', status: 'done', transactions: [String(paid)] });
      expect(byName['Rent B']).toMatchObject({ date: '2026-11-01', status: 'pending', transactions: [] });
    }
    expect(await prisma.event_occurrence_transactions.count({ where: { transaction_id: paid } })).toBe(1);
    // Manually linking the claimed payment elsewhere is refused
    await expectThrowErrorCode(() => linkTransaction(ctx.uid, BigInt(b.event_id), '2026-11-01', paid, NOW), 400);
    // Unlinking reverts A to pending and A is not auto-matched again; the freed payment may go to B
    await unlinkTransaction(ctx.uid, BigInt(a.event_id), '2026-11-01', paid);
    const after = (await upcoming(ctx.uid, 30, NOW)).filter((x) => x.date === '2026-11-01');
    expect(after.map((x) => [x.name, x.status, x.transactions])).toEqual([
      ['Rent A', 'pending', []],
      ['Rent B', 'done', [String(paid)]],
    ]);
  });

  test('card due auto-matches a transfer into the card account', async () => {
    const card = await ctx.account('Card 73', MYFIN.ACCOUNT_TYPES.CREDIT);
    await createEvent(
      ctx.uid,
      { name: 'Card 73 due', kind: 'card_due', date: '2026-01-10', repeat: 'monthly', account_id: Number(card.account_id) },
      NOW
    );
    const paid = await ctx.transfer(card.account_id, 13231, at(ym(2026, 11), 8));
    const item = (await upcoming(ctx.uid, 30, NOW)).find((x) => x.name === 'Card 73 due');
    expect(item).toMatchObject({ date: '2026-11-10', status: 'done', transactions: [String(paid)] });
  });

  test('manual link marks a money occurrence done; unlinking reverts; manual done works for any event', async () => {
    const ev = await createEvent(ctx.uid, { name: 'Netflix', kind: 'renewal', date: '2026-01-15', repeat: 'monthly', amount: 649 }, NOW);
    const trx = await ctx.spend('Card payment', 649, at(ym(2026, 11), 14));
    const id = BigInt(ev.event_id);
    await expectThrowErrorCode(() => linkTransaction(ctx.uid, id, '2026-11-16', trx, NOW), 400);
    const occ = await linkTransaction(ctx.uid, id, '2026-11-15', trx, NOW);
    expect(occ).toMatchObject({ date: '2026-11-15', status: 'done', transactions: [String(trx)] });
    expect((await upcoming(ctx.uid, 30, NOW)).find((x) => x.name === 'Netflix')).toMatchObject({ status: 'done' });
    const reverted = await unlinkTransaction(ctx.uid, id, '2026-11-15', trx);
    expect(reverted).toMatchObject({ status: 'pending', transactions: [] });

    const bday = await createEvent(ctx.uid, { name: 'Dad birthday', kind: 'birthday', date: '1960-11-20', repeat: 'yearly' }, NOW);
    await setOccurrenceDone(ctx.uid, BigInt(bday.event_id), '2026-11-20', true, NOW);
    expect((await upcoming(ctx.uid, 30, NOW)).find((x) => x.name === 'Dad birthday')).toMatchObject({ status: 'done' });
    await setOccurrenceDone(ctx.uid, BigInt(bday.event_id), '2026-11-20', false, NOW);
    expect((await upcoming(ctx.uid, 30, NOW)).find((x) => x.name === 'Dad birthday')).toMatchObject({ status: 'pending' });
  });

  test('suggestions: recurring payee, yearly cost, card due; dismiss and accept remove them', async () => {
    await ctx.spend('Paid to MAID', 3000, at(ym(2026, 8), 5));
    await ctx.spend('Paid to MAID', 3000, at(ym(2026, 9), 6));
    await ctx.spend('Paid to MAID', 3000, at(ym(2026, 10), 4));
    // Varies too much: not suggested
    await ctx.spend('Paid to CAFE', 300, at(ym(2026, 8), 1));
    await ctx.spend('Paid to CAFE', 300, at(ym(2026, 9), 15));
    await ctx.spend('Paid to CAFE', 300, at(ym(2026, 10), 25));
    const cost = await createYearlyCost(ctx.uid, { name: 'Car insurance', amount: 24000, due_month: 3 });
    const card = await ctx.account('Card 73', MYFIN.ACCOUNT_TYPES.CREDIT);
    await ctx.transfer(card.account_id, 5000, at(ym(2026, 9), 12));
    await ctx.transfer(card.account_id, 6000, at(ym(2026, 10), 14));

    const s = await suggestions(ctx.uid, NOW);
    const byKey = Object.fromEntries(s.map((x) => [x.key, x]));
    expect(Object.keys(byKey).sort()).toEqual(
      [`card:${card.account_id}`, 'recurring:MAID', `yearly:${cost.yearly_cost_id}`].sort()
    );
    expect(byKey['recurring:MAID']).toMatchObject({ repeat: 'monthly', date: '2026-11-05', payee_key: 'MAID', amount: 3000 });
    expect(byKey[`yearly:${cost.yearly_cost_id}`]).toMatchObject({ repeat: 'yearly', date: '2027-03-01', amount: 24000 });
    expect(byKey[`card:${card.account_id}`]).toMatchObject({
      kind: 'card_due',
      repeat: 'monthly',
      date: '2026-11-13',
      account_id: String(card.account_id),
    });

    await dismissSuggestion(ctx.uid, 'recurring:MAID');
    const { key: _k, ...accept } = byKey[`yearly:${cost.yearly_cost_id}`];
    await createEvent(ctx.uid, { ...accept, source_key: `yearly:${cost.yearly_cost_id}` }, NOW);
    expect((await suggestions(ctx.uid, NOW)).map((x) => x.key)).toEqual([`card:${card.account_id}`]);
  });

  test("ownership: another user's event is 401", async () => {
    const other = await setup('ev2');
    const ev = await createEvent(other.uid, rent(), NOW);
    const id = BigInt(ev.event_id);
    await expectThrowErrorCode(() => updateEvent(ctx.uid, id, rent()), 401);
    await expectThrowErrorCode(() => deleteEvent(ctx.uid, id), 401);
    await expectThrowErrorCode(() => setOccurrenceDone(ctx.uid, id, '2026-11-01', true, NOW), 401);
    const mine = await ctx.spend('x', 10, NOW);
    await expectThrowErrorCode(() => linkTransaction(ctx.uid, id, '2026-11-01', mine, NOW), 401);
    // Another user's transaction cannot be linked to my event either
    const own = await createEvent(ctx.uid, rent(), NOW);
    const theirs = await other.spend('y', 10, NOW);
    await expectThrowErrorCode(() => linkTransaction(ctx.uid, BigInt(own.event_id), '2026-11-01', theirs, NOW), 401);
    const put = await fetch(`${base}/events/${id}`, { method: 'PUT', headers: ctx.headers, body: JSON.stringify(rent()) });
    expect(put.status).toBe(401);
    const linkRes = await fetch(`${base}/events/occurrences/${id}/2026-11-01/link`, {
      method: 'POST',
      headers: ctx.headers,
      body: JSON.stringify({ transaction_id: Number(mine) }),
    });
    expect(linkRes.status).toBe(401);
    const unlinkRes = await fetch(`${base}/events/occurrences/${id}/2026-11-01/link/${theirs}`, {
      method: 'DELETE',
      headers: ctx.headers,
    });
    expect(unlinkRes.status).toBe(401);
    expect((await listEvents(ctx.uid, NOW)).map((e) => e.name)).toEqual(['Rent']);
  });

  test('HTTP routes', async () => {
    const created = await fetch(`${base}/events`, {
      method: 'POST',
      headers: ctx.headers,
      body: JSON.stringify({ name: 'Amma birthday', kind: 'birthday', date: '1965-11-02', repeat: 'yearly', gift_budget: 3000 }),
    });
    expect(created.status).toBe(200);
    const ev = await created.json();
    const bad = await fetch(`${base}/events`, {
      method: 'POST',
      headers: ctx.headers,
      body: JSON.stringify({ name: 'X', kind: 'party', date: '2026-02-30', repeat: 'weekly' }),
    });
    expect(bad.status).toBe(400);
    const up = await fetch(`${base}/events/upcoming?days=30`, { headers: ctx.headers });
    expect(up.status).toBe(200);
    expect(Array.isArray(await up.json())).toBe(true);
    expect((await fetch(`${base}/events/upcoming?days=0`, { headers: ctx.headers })).status).toBe(400);
    const done = await fetch(`${base}/events/occurrences/${ev.event_id}/2027-11-02/done`, {
      method: 'POST',
      headers: ctx.headers,
      body: JSON.stringify({ done: true }),
    });
    expect(done.status).toBe(200);
    expect((await done.json()).status).toBe('done');
    const list = await (await fetch(`${base}/events`, { headers: ctx.headers })).json();
    expect(list[0].name).toBe('Amma birthday');
    expect((await fetch(`${base}/events/suggestions`, { headers: ctx.headers })).status).toBe(200);
    const dismiss = await fetch(`${base}/events/suggestions/dismiss`, {
      method: 'POST',
      headers: ctx.headers,
      body: JSON.stringify({ key: 'recurring:X' }),
    });
    expect(dismiss.status).toBe(200);
    expect((await fetch(`${base}/events/${ev.event_id}`, { method: 'DELETE', headers: ctx.headers })).status).toBe(200);
  });

  test('a payment outside ±5 days is ignored', async () => {
    await createEvent(ctx.uid, rent(), NOW);
    await ctx.spend('Paid to RENT CO', 15000, at(ym(2026, 11), 7)); // 6 days after the 1st
    const item = (await upcoming(ctx.uid, 30, NOW)).find((x) => x.date === '2026-11-01');
    expect(item).toMatchObject({ name: 'Rent', status: 'pending', transactions: [] });
  });

  test('deleting a linked transaction: link-only done returns to pending, manual done stays done', async () => {
    const ev = await createEvent(ctx.uid, rent(), NOW);
    const paid = await ctx.spend('Paid to RENT CO', 15000, at(ym(2026, 11), 1));
    expect((await upcoming(ctx.uid, 30, NOW)).find((x) => x.date === '2026-11-01')).toMatchObject({ status: 'done' });
    await TransactionService.deleteTransaction(ctx.uid, Number(paid));
    expect((await upcoming(ctx.uid, 30, NOW)).find((x) => x.date === '2026-11-01')).toMatchObject({
      status: 'pending',
      transactions: [],
    });

    const netflix = await createEvent(ctx.uid, { name: 'Netflix', kind: 'renewal', date: '2026-01-15', repeat: 'monthly', amount: 649 }, NOW);
    const trx = await ctx.spend('Card payment', 649, at(ym(2026, 11), 14));
    await linkTransaction(ctx.uid, BigInt(netflix.event_id), '2026-11-15', trx, NOW);
    const marked = await setOccurrenceDone(ctx.uid, BigInt(netflix.event_id), '2026-11-15', true, NOW);
    expect(marked).toMatchObject({ status: 'done', done_manual: true });
    await TransactionService.deleteTransaction(ctx.uid, Number(trx));
    expect((await upcoming(ctx.uid, 30, NOW)).find((x) => x.name === 'Netflix')).toMatchObject({
      status: 'done',
      transactions: [],
    });
    // Undone by hand while still linked: a money occurrence stays done through its link
    const other = await ctx.spend('Card payment', 649, at(ym(2026, 11), 14));
    await linkTransaction(ctx.uid, BigInt(netflix.event_id), '2026-11-15', other, NOW);
    expect(await setOccurrenceDone(ctx.uid, BigInt(netflix.event_id), '2026-11-15', false, NOW)).toMatchObject({
      status: 'done',
      done_manual: false,
    });
    expect(ev).toBeTruthy();
  });

  test('moving an event drops stranded occurrences so their payments can match again', async () => {
    const ev = await createEvent(ctx.uid, rent(), NOW);
    const paid = await ctx.spend('Paid to RENT CO', 15000, at(ym(2026, 11), 1));
    expect((await upcoming(ctx.uid, 30, NOW)).find((x) => x.date === '2026-11-01')).toMatchObject({
      status: 'done',
      transactions: [String(paid)],
    });
    await updateEvent(ctx.uid, BigInt(ev.event_id), { ...rent(), date: '2026-01-05' }, NOW);
    expect(await prisma.event_occurrences.count({ where: { events_event_id: BigInt(ev.event_id), date: '2026-11-01' } })).toBe(0);
    const items = (await upcoming(ctx.uid, 30, NOW)).filter((x) => x.name === 'Rent');
    expect(items.map((x) => [x.date, x.status, x.transactions])).toEqual([
      ['2026-11-05', 'done', [String(paid)]],
    ]);
  });

  test('manual link refuses adjustments and debt rows; deleting a category clears it on events', async () => {
    const ev = await createEvent(ctx.uid, { name: 'Netflix', kind: 'renewal', date: '2026-01-15', repeat: 'monthly' }, NOW);
    const adj = await prisma.transactions.create({
      data: {
        date_timestamp: at(ym(2026, 11), 14),
        amount: 1000,
        type: E,
        description: 'Write-off',
        accounts_account_from_id: ctx.bank.account_id,
        is_adjustment: true,
      },
    });
    await expectThrowErrorCode(() => linkTransaction(ctx.uid, BigInt(ev.event_id), '2026-11-15', adj.transaction_id, NOW), 400);
    const lent = await prisma.transactions.create({
      data: {
        date_timestamp: at(ym(2026, 11), 14),
        amount: 1000,
        type: E,
        description: 'Lent',
        accounts_account_from_id: ctx.bank.account_id,
        debt_role: 'lend',
      },
    });
    await expectThrowErrorCode(() => linkTransaction(ctx.uid, BigInt(ev.event_id), '2026-11-15', lent.transaction_id, NOW), 400);

    const cat = await prisma.categories.create({ data: { name: 'Subscriptions', type: E, users_user_id: ctx.uid } });
    await updateEvent(ctx.uid, BigInt(ev.event_id), { name: 'Netflix', kind: 'renewal', date: '2026-01-15', repeat: 'monthly', category_id: Number(cat.category_id) }, NOW);
    await CategoryService.deleteCategory(ctx.uid, Number(cat.category_id));
    expect((await prisma.events.findUniqueOrThrow({ where: { event_id: BigInt(ev.event_id) } })).category_id).toBeNull();
    expect((await listEvents(ctx.uid, NOW))[0].category_id).toBeNull();
  });

  test('backup: a JSON round trip keeps events, occurrences, links and dismissals', async () => {
    const card = await ctx.account('Card 73', MYFIN.ACCOUNT_TYPES.CREDIT);
    const ev = await createEvent(ctx.uid, rent(), NOW);
    const cardEv = await createEvent(
      ctx.uid,
      { name: 'Card due', kind: 'card_due', date: '2026-01-13', repeat: 'monthly', account_id: Number(card.account_id), source_key: `card:${card.account_id}` },
      NOW
    );
    const bday = await createEvent(ctx.uid, { name: 'Amma birthday', kind: 'birthday', date: '1965-11-02', repeat: 'yearly', gift_budget: 3000 }, NOW);
    const paid = await ctx.spend('Paid to RENT CO', 15000, at(ym(2026, 11), 1));
    const gift = await ctx.spend('Saree shop', 700, at(ym(2026, 10), 30));
    const bdayTag = await prisma.tags.findFirstOrThrow({ where: { users_user_id: ctx.uid, name: 'event:Amma birthday' } });
    await TagService.addTagToTransaction(ctx.uid, gift, bdayTag.tag_id);
    await upcoming(ctx.uid, 30, NOW); // auto-match
    await setOccurrenceDone(ctx.uid, BigInt(bday.event_id), '2025-11-02', true, NOW);
    await dismissSuggestion(ctx.uid, 'recurring:MAID');
    await dismissSuggestion(ctx.uid, `card:${card.account_id}`);
    expect(await prisma.event_occurrence_transactions.count({ where: { transaction_id: paid } })).toBe(1);

    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(ctx.uid)));
    await UserService.restoreUser(ctx.uid, backup);

    const newCard = await prisma.accounts.findFirstOrThrow({ where: { users_user_id: ctx.uid, name: 'Card 73' } });
    const events = await prisma.events.findMany({ where: { users_user_id: ctx.uid }, include: { tag: true, occurrences: { include: { transactions: { include: { transaction: true } } } } }, orderBy: { name: 'asc' } });
    expect(events.map((e) => [e.name, e.kind, e.tag?.name, e.source_key, e.account_id])).toEqual([
      ['Amma birthday', 'birthday', 'event:Amma birthday', null, null],
      ['Card due', 'card_due', 'event:Card due', `card:${newCard.account_id}`, newCard.account_id],
      ['Rent', 'rent', 'event:Rent', null, null],
    ]);
    expect(events[0].gift_budget).toBe(300000n);
    expect(events[0].occurrences.map((o) => [o.date, o.status])).toEqual([['2025-11-02', 'done']]);
    const rentOcc = events[2].occurrences;
    expect(rentOcc.map((o) => [o.date, o.status])).toEqual([['2026-11-01', 'done']]);
    expect(rentOcc[0].transactions.map((l) => l.transaction.description)).toEqual(['Paid to RENT CO']);
    expect(rentOcc[0].transactions[0].transaction_id).not.toBe(paid);
    const dismissals = await prisma.event_suggestion_dismissals.findMany({ where: { users_user_id: ctx.uid }, orderBy: { key: 'asc' } });
    expect(dismissals.map((d) => d.key)).toEqual([`card:${newCard.account_id}`, 'recurring:MAID']);
    expect(ev.event_id).not.toBe(String(events[2].event_id));
    expect(events[0].occurrences[0].done_manual).toBe(true);
    // Tagged-only gift spend survives (transaction tags are backed up)
    const restoredBday = (await upcoming(ctx.uid, 30, NOW)).find((x) => x.name === 'Amma birthday');
    expect(restoredBday).toMatchObject({ gift_spent: 700, transactions: [] });
    // An old backup without the key restores without tag links
    const old = JSON.parse(JSON.stringify(await BackupManager.createBackup(ctx.uid)));
    expect(old.transaction_has_tags).toHaveLength(1);
    delete old.transaction_has_tags;
    await UserService.restoreUser(ctx.uid, old);
    expect(await prisma.transaction_has_tags.count({ where: { tags: { users_user_id: ctx.uid } } })).toBe(0);
    expect(cardEv).toBeTruthy();

    // A malformed event is refused before the wipe
    const broken = JSON.parse(JSON.stringify(await BackupManager.createBackup(ctx.uid)));
    broken.events[0].repeat = 'weekly';
    await expectThrowErrorCode(() => UserService.restoreUser(ctx.uid, broken), 406);
    const noCreated = JSON.parse(JSON.stringify(await BackupManager.createBackup(ctx.uid)));
    noCreated.events[0].created_at = 'x';
    await expectThrowErrorCode(() => UserService.restoreUser(ctx.uid, noCreated), 406);
    const badTag = JSON.parse(JSON.stringify(await BackupManager.createBackup(ctx.uid)));
    badTag.transaction_has_tags = [{ transaction_id: badTag.transactions[0].transaction_id, tag_id: 999999999 }];
    await expectThrowErrorCode(() => UserService.restoreUser(ctx.uid, badTag), 406);
    expect(await prisma.events.count({ where: { users_user_id: ctx.uid } })).toBe(3);
  });
});
