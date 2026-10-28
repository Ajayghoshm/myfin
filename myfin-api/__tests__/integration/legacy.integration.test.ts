import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import AccountService from '../../src/services/accountService.js';
import { createLoan } from '../../src/services/debts/loanService.js';
import { createPeopleDebt } from '../../src/services/debts/debtService.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';

const E = MYFIN.TRX_TYPES.EXPENSE;
const NOW = Math.floor(Date.now() / 1000);

async function setup(username: string) {
  const user = await UserService.createUser({ username, password: '123', email: `${username}@x.com` });
  const uid = user.user_id;
  const bank = await AccountService.createAccount(
    {
      name: `Bank ${username}`,
      type: MYFIN.ACCOUNT_TYPES.CHECKING,
      description: '',
      status: MYFIN.ACCOUNT_STATUS.ACTIVE,
      exclude_from_budgets: false,
      current_balance: 5000,
      users_user_id: uid,
    } as never,
    uid
  );
  const login = await UserService.attemptLogin(username, '123', false);
  const headers = { authusername: username, sessionkey: login.sessionkey, 'content-type': 'application/json' };
  return { uid, bank, headers };
}

describe('legacy file', () => {
  let baseUrl: string;
  let server: Server;
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(async () => {
    ctx = await setup('leg');
  });

  const post = (body: unknown, headers = ctx.headers) =>
    fetch(`${baseUrl}/legacy`, { method: 'POST', headers, body: JSON.stringify(body) });
  const get = async (headers = ctx.headers) => (await fetch(`${baseUrl}/legacy`, { headers })).json();

  test('CRUD works for all four kinds', async () => {
    const bodies = [
      { kind: 'account', account_id: String(ctx.bank.account_id), data: { bank_branch: 'HDFC Indiranagar', nominee: 'Asha', documents_location: 'Locker 4' } },
      { kind: 'policy', data: { insurer: 'LIC', policy_number: 'P1', sum_assured: 500000, nominee: 'Asha', claim_helpline: '1800', documents_location: 'Safe' } },
      { kind: 'contact', data: { role: 'CA', name: 'Mr. Pinto', phone: '+91 98765 43210', email: 'ca@x.com' } },
      { kind: 'instruction', data: { text: 'Call the CA first.' } },
    ];
    const created = [];
    for (const b of bodies) {
      const res = await post(b);
      expect(res.status).toBe(200);
      created.push(await res.json());
    }
    const listed = await get();
    expect(listed.entries).toHaveLength(4);
    expect(listed.accounts.some((a: { account_id: string }) => a.account_id === String(ctx.bank.account_id))).toBe(true);

    const put = await fetch(`${baseUrl}/legacy/${created[3].entry_id}`, {
      method: 'PUT',
      headers: ctx.headers,
      body: JSON.stringify({ data: { text: 'Updated' } }),
    });
    expect(put.status).toBe(200);
    expect((await get()).entries.find((e: { kind: string }) => e.kind === 'instruction').data.text).toBe('Updated');

    const tooLong = await post({ kind: 'instruction', data: { text: 'x'.repeat(5001) } });
    expect(tooLong.status).toBe(400);
    const badEmail = await post({ kind: 'contact', data: { role: 'CA', name: 'A', email: 'nope' } });
    expect(badEmail.status).toBe(400);

    expect((await fetch(`${baseUrl}/legacy/${created[0].entry_id}`, { method: 'DELETE', headers: ctx.headers })).status).toBe(200);
    expect((await get()).entries).toHaveLength(3);
  });

  test('account entries need an own account and are unique per account', async () => {
    const data = { bank_branch: 'B' };
    expect((await post({ kind: 'account', data })).status).toBe(400);
    const other = await setup('other');
    expect((await post({ kind: 'account', account_id: String(other.bank.account_id), data })).status).toBe(401);
    expect((await post({ kind: 'account', account_id: String(ctx.bank.account_id), data })).status).toBe(200);
    expect((await post({ kind: 'account', account_id: String(ctx.bank.account_id), data })).status).toBe(400);
  });

  test('secrets are rejected, words like Pinto are not', async () => {
    const unknownKey = await post({ kind: 'policy', data: { insurer: 'X', password: 'y' } });
    expect(unknownKey.status).toBe(400);
    expect(JSON.stringify(await unknownKey.json())).toContain("Don't store passwords, PINs or OTPs here");
    const value = await post({ kind: 'instruction', data: { text: 'my PIN is 1234' } });
    expect(value.status).toBe(400);
    expect(JSON.stringify(await value.json())).toContain("Don't store passwords, PINs or OTPs here");
    expect((await post({ kind: 'instruction', data: { text: 'the otp is 55' } })).status).toBe(400);
    expect((await post({ kind: 'contact', data: { role: 'CA', name: 'Mr. Pinto' } })).status).toBe(200);
    expect((await post({ kind: 'instruction', data: { text: 'In my opinion, call the notary' } })).status).toBe(200);
  });

  test('suggests insurer payees until a policy exists for them', async () => {
    await TransactionService.createTransaction(ctx.uid, {
      account_from_id: ctx.bank.account_id,
      amount: 1200,
      type: E,
      description: 'Paid to STARHEALTH PREMIUM',
      date_timestamp: NOW - 86400,
      is_essential: false,
    } as never);
    await TransactionService.createTransaction(ctx.uid, {
      account_from_id: ctx.bank.account_id,
      amount: 50,
      type: E,
      description: 'Paid to GROCER',
      date_timestamp: NOW - 86400,
      is_essential: false,
    } as never);
    const first = await get();
    expect(first.suggestions).toEqual([
      { payee_key: 'STARHEALTH PREMIUM', last_amount: 1200, last_date: expect.any(Number) },
    ]);
    await post({ kind: 'policy', data: { insurer: 'starhealth' } });
    expect((await get()).suggestions).toEqual([]);
  });

  test('suggests LIC as a whole word (word boundary works in SQL)', async () => {
    for (const description of ['Paid to LIC PREMIUM', 'Paid to RELIC STORE']) {
      await TransactionService.createTransaction(ctx.uid, {
        account_from_id: ctx.bank.account_id,
        amount: 900,
        type: E,
        description,
        date_timestamp: NOW - 86400,
        is_essential: false,
      } as never);
    }
    expect((await get()).suggestions).toEqual([{ payee_key: 'LIC PREMIUM', last_amount: 900, last_date: expect.any(Number) }]);
  });

  test('includes live loans and people debts', async () => {
    await createLoan(ctx.uid, {
      lender: 'HDFC',
      principal: 100000,
      rate: 10,
      tenure_months: 12,
      emi: 8792,
      emi_day: 5,
      account_id: ctx.bank.account_id,
      start_date: NOW - 86400 * 30,
    } as never);
    await createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Rahul', amount: 700, date: NOW - 86400 });
    const res = await get();
    expect(res.debts.loans).toHaveLength(1);
    expect(res.debts.loans[0].lender).toBe('HDFC');
    expect(res.debts.people.map((d: { counterparty_name: string }) => d.counterparty_name)).toEqual(['Rahul']);
  });

  test("another user's entries are 401", async () => {
    const created = await (await post({ kind: 'instruction', data: { text: 'mine' } })).json();
    const other = await setup('intruder');
    const put = await fetch(`${baseUrl}/legacy/${created.entry_id}`, {
      method: 'PUT',
      headers: other.headers,
      body: JSON.stringify({ data: { text: 'x' } }),
    });
    expect(put.status).toBe(401);
    expect((await fetch(`${baseUrl}/legacy/${created.entry_id}`, { method: 'DELETE', headers: other.headers })).status).toBe(401);
    expect((await get(other.headers)).entries).toEqual([]);
  });

  test('backup JSON round trip keeps entries with remapped account ids; wipe removes them', async () => {
    await post({ kind: 'account', account_id: String(ctx.bank.account_id), data: { nominee: 'Asha' } });
    await post({ kind: 'policy', data: { insurer: 'LIC', sum_assured: 100 } });
    const backupRes = await fetch(`${baseUrl}/user/backup`, { headers: ctx.headers });
    const backup = await backupRes.json();
    expect(backup.legacy_entries).toHaveLength(2);
    const restored = await fetch(`${baseUrl}/user/restore`, { method: 'PUT', headers: ctx.headers, body: JSON.stringify(backup) });
    expect(restored.status).toBe(200);
    const after = await get();
    expect(after.entries).toHaveLength(2);
    const acct = after.entries.find((e: { kind: string }) => e.kind === 'account');
    const accounts = await prisma.accounts.findMany({ where: { users_user_id: ctx.uid } });
    expect(accounts.map((a) => String(a.account_id))).toContain(acct.account_id);
    expect(acct.data.nominee).toBe('Asha');
    expect(after.entries.find((e: { kind: string }) => e.kind === 'policy').data.sum_assured).toBe(100);

    await UserService.deleteAllUserData(ctx.uid);
    expect(await prisma.legacy_entries.count({ where: { users_user_id: ctx.uid } })).toBe(0);
  });

  test('secrets in PUT, nested and array values are rejected; invalid kind with a secret is 400 and not logged', async () => {
    const created = await (await post({ kind: 'instruction', data: { text: 'ok' } })).json();
    const put = await fetch(`${baseUrl}/legacy/${created.entry_id}`, {
      method: 'PUT',
      headers: ctx.headers,
      body: JSON.stringify({ data: { text: 'cvv is 123' } }),
    });
    expect(put.status).toBe(400);
    expect((await post({ kind: 'contact', data: { name: { nested: 'my password' } } })).status).toBe(400);
    expect((await post({ kind: 'contact', data: { name: ['fine', 'the OTP'] } })).status).toBe(400);

    process.env.LOGGING = 'true';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const res = await post({ kind: 'bogus', data: { text: 'TOP-SECRET-PIN 1234' } });
      expect(res.status).toBe(400);
      const logged = spy.mock.calls.map((c) => JSON.stringify(c)).join('\n');
      expect(logged).not.toContain('TOP-SECRET');
    } finally {
      spy.mockRestore();
      process.env.LOGGING = 'false';
    }
  });

  test('restore rejects bad legacy entries (406); deleting an account drops its entry', async () => {
    await post({ kind: 'instruction', data: { text: 'ok' } });
    const backup = await (await fetch(`${baseUrl}/user/backup`, { headers: ctx.headers })).json();
    for (const bad of [
      { kind: 'bogus', data: {} },
      { kind: 'instruction', data: { text: 'my password is x' } },
      { kind: 'policy', data: { unknown_field: 'x' } },
    ]) {
      const body = { ...backup, legacy_entries: [{ ...backup.legacy_entries[0], ...bad }] };
      const res = await fetch(`${baseUrl}/user/restore`, { method: 'PUT', headers: ctx.headers, body: JSON.stringify(body) });
      expect(res.status).toBe(406);
    }
    expect((await get()).entries).toHaveLength(1);

    const extra = await AccountService.createAccount(
      { name: 'Temp', type: MYFIN.ACCOUNT_TYPES.CHECKING, description: '', status: MYFIN.ACCOUNT_STATUS.ACTIVE, exclude_from_budgets: false, current_balance: 0, users_user_id: ctx.uid } as never,
      ctx.uid
    );
    await post({ kind: 'account', account_id: String(extra.account_id), data: { nominee: 'A' } });
    expect((await get()).entries).toHaveLength(2);
    await AccountService.deleteAccount(extra.account_id);
    expect((await get()).entries).toHaveLength(1);
  });
});
