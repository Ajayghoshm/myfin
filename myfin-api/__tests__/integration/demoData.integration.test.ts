import { beforeEach, describe, expect, test } from 'vitest';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import { listDebts } from '../../src/services/debts/debtService.js';
import { listLoans } from '../../src/services/debts/loanService.js';
import {
  type YearMonth,
  monthRangeIST,
  shiftMonth,
} from '../../src/services/insights/insightsPrimitives.js';
import { smallSpends } from '../../src/services/insights/smallSpendService.js';
import { typicalMonth } from '../../src/services/insights/typicalMonth.js';
import { getLegacy } from '../../src/services/legacyService.js';
import { emergencyFund } from '../../src/services/planning/emergencyFundService.js';
import { forecast } from '../../src/services/planning/forecastService.js';
import { safeToSpend } from '../../src/services/planning/safeToSpendService.js';
import { currentSalaryPlan } from '../../src/services/planning/salaryPlanService.js';
import { listYearlyCosts } from '../../src/services/planning/yearlyCostService.js';
import { listEvents } from '../../src/services/routines/eventService.js';
import { healthScore } from '../../src/services/routines/healthScoreService.js';
import UserService from '../../src/services/userService.js';
import { balancesAt, netWorthChange } from '../../src/services/wealth/netWorthService.js';
import { getRetirement } from '../../src/services/wealth/retirementService.js';
import { BONUS, LAPTOP, demoCalendar } from '../../src/utils/demoData/dataset.js';
import DemoDataManager from '../../src/utils/demoDataManager.js';

const SLOW = 180_000;

async function counts(uid: bigint) {
  const owned = { accounts: { users_user_id: uid } };
  return {
    accounts: await prisma.accounts.count({ where: { users_user_id: uid } }),
    transactions: await prisma.transactions.count({
      where: {
        OR: [
          { accounts_transactions_accounts_account_from_idToaccounts: owned.accounts },
          { accounts_transactions_accounts_account_to_idToaccounts: owned.accounts },
        ],
      },
    }),
    debts: await prisma.debts.count({ where: { users_user_id: uid } }),
    events: await prisma.events.count({ where: { users_user_id: uid } }),
    categories: await prisma.categories.count({ where: { users_user_id: uid } }),
    budgets: await prisma.budgets.count({ where: { users_user_id: uid } }),
    goals: await prisma.goals.count({ where: { users_user_id: uid } }),
    legacy: await prisma.legacy_entries.count({ where: { users_user_id: uid } }),
    yearly: await prisma.yearly_costs.count({ where: { users_user_id: uid } }),
    planned: await prisma.planned_transactions.count({ where: { users_user_id: uid } }),
    checks: await prisma.balance_checks.count({ where: { accounts: { users_user_id: uid } } }),
  };
}

const idOf = async (uid: bigint, description: string) =>
  (
    await prisma.transactions.findFirstOrThrow({
      where: {
        description,
        accounts_transactions_accounts_account_to_idToaccounts: { users_user_id: uid },
      },
    })
  ).transaction_id;

describe('demo data', () => {
  let uid: bigint;
  let current: YearMonth;
  let last: YearMonth;

  beforeEach(async () => {
    const user = await UserService.createUser({
      username: 'demo',
      password: '123',
      email: 'demo@afaneca.com',
    });
    uid = user.user_id;
    await UserService.autoPopulateDemoData(uid);
    current = demoCalendar().current;
    last = shiftMonth(current, -1);
  }, SLOW);

  test(
    'sets INR and creates the accounts, loan and people debts',
    async () => {
      const user = await prisma.users.findUniqueOrThrow({ where: { user_id: uid } });
      expect(user.currency).toBe('INR');

      const accounts = await prisma.accounts.findMany({ where: { users_user_id: uid } });
      const types = accounts.map((a) => a.type).sort();
      expect(types).toEqual(
        [
          MYFIN.ACCOUNT_TYPES.CHECKING,
          MYFIN.ACCOUNT_TYPES.CREDIT,
          MYFIN.ACCOUNT_TYPES.INVESTING,
          MYFIN.ACCOUNT_TYPES.LOAN,
          MYFIN.ACCOUNT_TYPES.SAVINGS,
          MYFIN.ACCOUNT_TYPES.SAVINGS,
        ].sort()
      );

      const loans = await listLoans(uid);
      expect(loans).toHaveLength(1);
      const matched = loans[0].schedule.filter(
        (r) => r.status === 'paid' && r.transaction_id != null
      );
      expect(matched.length).toBeGreaterThan(0);
      expect(loans[0].emi).toBeCloseTo(21_696, -1);
      expect(loans[0].missed_count).toBe(0);
      expect(loans[0].outstanding_principal).toBeLessThan(2_500_000);
      // Each matched debit became the interest part; its principal moved to the loan account
      const interest = await prisma.transactions.count({
        where: { debt_id: BigInt(loans[0].debt_id), debt_role: 'interest' },
      });
      expect(interest).toBe(matched.length);

      const { debts } = await listDebts(uid);
      const arjun = debts.find((d) => d.counterparty_name === 'Arjun');
      const meera = debts.find((d) => d.counterparty_name === 'Meera');
      expect(arjun).toMatchObject({ kind: 'lent', outstanding: 3_000, status: 'open' });
      expect(meera).toMatchObject({ kind: 'borrowed', outstanding: 0, status: 'settled' });
    },
    SLOW
  );

  test(
    'typical month: 3 baseline months, the laptop and the bonus are one-offs',
    async () => {
      const typical = await typicalMonth(uid, current);
      expect(typical.baselineMonths).toBe(3);
      const laptop = await prisma.transactions.findFirstOrThrow({
        where: { description: 'CROMA - Laptop', amount: LAPTOP * 100 },
      });
      const bonus = await idOf(uid, 'DIWALI BONUS - NIMBUS SOFTWARE');
      expect(typical.oneOffIds.has(laptop.transaction_id.toString())).toBe(true);
      expect(typical.oneOffIds.has(bonus.toString())).toBe(true);
      expect(typical.oneOffIds.size).toBe(2);
      expect(typical.incomeCents).toBe(120_000_00);
      expect(BONUS).toBeGreaterThanOrEqual(1.5 * 120_000);
      expect(typical.fixedCents).toBeGreaterThan(0);

      const small = await smallSpends(uid, last);
      expect(small.count).toBeGreaterThan(0);
    },
    SLOW
  );

  test(
    'every feature returns figures',
    async () => {
      const sts = await safeToSpend(uid);
      expect(sts.typical_income).toBe(120_000);
      expect(sts.has_fixed_categories).toBe(true);

      const ef = await emergencyFund(uid);
      expect(ef.status).not.toBe('no_accounts');
      expect(ef.status).not.toBe('no_fixed');
      expect(ef.fund).toBeGreaterThan(0);

      const plan = await currentSalaryPlan(uid);
      expect(plan.state).not.toBe('none');
      expect(plan.buckets.length).toBeGreaterThan(0);

      const retirement = await getRetirement(uid);
      expect(retirement.corpus_needed).not.toBeNull();
      expect(retirement.inputs.current_corpus).toBeGreaterThan(0);

      expect(await listYearlyCosts(uid)).toHaveLength(2);
      expect((await listYearlyCosts(uid)).some((c) => c.linked_count > 0)).toBe(true);

      const events = await listEvents(uid);
      expect(events.length).toBeGreaterThanOrEqual(3);
      const cardDue = events.find((e) => e.kind === 'card_due');
      expect(cardDue?.history.some((o) => o.status === 'done' && o.transactions.length > 0)).toBe(
        true
      );

      const legacy = await getLegacy(uid);
      expect(legacy.entries.length).toBeGreaterThanOrEqual(3);

      const next = await forecast(uid, shiftMonth(current, 1));
      expect(next.categories.length).toBeGreaterThan(0);
      expect(next.total).toBeGreaterThan(0);
      expect(next.income).toBe(120_000);

      const nw = await netWorthChange(uid, last);
      expect(nw.accounts.length).toBeGreaterThan(0);
      expect(nw.end).not.toBe(0);
      expect(nw.accounts.some((a) => a.account_id === 'investments')).toBe(true);

      const health = await healthScore(uid, last);
      expect(health.checks.filter((c) => c.status === 'not_set_up').length).toBeLessThanOrEqual(2);
    },
    SLOW
  );

  test(
    'no transaction is dated in the future',
    async () => {
      const now = Math.floor(Date.now() / 1000);
      const future = await prisma.transactions.count({
        where: {
          date_timestamp: { gt: now },
          OR: [
            { accounts_transactions_accounts_account_from_idToaccounts: { users_user_id: uid } },
            { accounts_transactions_accounts_account_to_idToaccounts: { users_user_id: uid } },
          ],
        },
      });
      expect(future).toBe(0);

      // Stored balances agree with the rows, and money accounts never went negative at a month end
      const accounts = await prisma.accounts.findMany({ where: { users_user_id: uid } });
      const ids = accounts.map((a) => a.account_id);
      const atNow = await balancesAt(ids, [now + 1]);
      for (const a of accounts)
        expect(Number(a.current_balance)).toBe(atNow.get(a.account_id.toString())?.[0]);
      const ends = Array.from(
        { length: 7 },
        (_, i) => monthRangeIST(shiftMonth(current, i - 6)).to
      ).filter((t) => t <= now);
      const series = await balancesAt(ids, ends);
      for (const a of accounts.filter(
        (x) => x.type === MYFIN.ACCOUNT_TYPES.CHECKING || x.type === MYFIN.ACCOUNT_TYPES.SAVINGS
      ))
        for (const cents of series.get(a.account_id.toString()) ?? [])
          expect(cents).toBeGreaterThan(0);
    },
    SLOW
  );

  test(
    'populating again gives the same shape',
    async () => {
      const first = await counts(uid);
      await UserService.autoPopulateDemoData(uid);
      const second = await counts(uid);
      expect(second).toEqual(first);
      expect(first).toMatchObject({
        accounts: 6,
        debts: 3,
        events: 4,
        legacy: 4,
        yearly: 2,
        goals: 2,
      });
      expect(first.transactions).toBeGreaterThan(150);
    },
    SLOW
  );
});
