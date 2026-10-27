import { beforeEach, describe, expect, test } from 'vitest';
import { prisma } from '../../src/config/prisma.js';
import GoalService, { type CreateGoalType } from '../../src/services/goalService.js';
import { monthRangeIST, type YearMonth } from '../../src/services/insights/insightsPrimitives.js';
import UserService from '../../src/services/userService.js';
import BackupManager from '../../src/utils/backupManager.js';
import { expectThrowErrorCode } from './utils/testUtils.js';

const DAY = 86_400;
const NOW = monthRangeIST({ year: 2026, month: 11 }).from + DAY; // 2 Nov 2026 IST
const REL = 'relative';
const ABS = 'absolute';

async function setup() {
  const user = await UserService.createUser({ username: 'ga', password: '123', email: 'ga@x.com' });
  const other = await UserService.createUser({ username: 'gb', password: '123', email: 'gb@x.com' });
  const uid = user.user_id;
  const asset = async (owner: bigint, name: string, valueCents: number) => {
    const a = await prisma.invest_assets.create({
      data: { name, type: 'stock', units: 1, created_at: 1, users_user_id: owner },
    });
    await prisma.invest_asset_evo_snapshot.create({
      data: {
        month: 10,
        year: 2026,
        units: 1,
        invested_amount: valueCents,
        current_value: valueCents,
        invest_assets_asset_id: a.asset_id,
        created_at: 1,
        updated_at: 1,
        withdrawn_amount: 0,
      },
    });
    return a;
  };
  const buy = (assetId: bigint, ym: YearMonth, cents: number, type: 'B' | 'S' = 'B') =>
    prisma.invest_transactions.create({
      data: {
        date_timestamp: monthRangeIST(ym).from + 5 * DAY,
        type,
        total_price: cents,
        units: 1,
        invest_assets_asset_id: assetId,
        created_at: 1,
        updated_at: 1,
      },
    });
  let n = 0;
  const goal = (assets: CreateGoalType['funding_assets'], extra: Partial<CreateGoalType> = {}) =>
    GoalService.createGoal(
      { name: `G${++n}`, priority: n, amount: 100000, funding_accounts: [], funding_assets: assets, ...extra },
      uid
    );
  const list = async () =>
    (await GoalService.getGoalsForUser(uid, false, undefined, NOW)).goals.sort((a, b) => a.goal_id - b.goal_id);
  return { uid, other, asset, buy, goal, list };
}

const link = (asset: { asset_id: bigint }, type: string, value: number) => ({
  asset_id: Number(asset.asset_id),
  funding_type: type as 'relative' | 'absolute',
  funding_amount: value,
});

describe('goal-linked investments', () => {
  let c: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    c = await setup();
  });

  test('relative shares fund each goal from the current value', async () => {
    const a = await c.asset(c.uid, 'Fund', 10_000_000);
    await c.goal([link(a, REL, 60)]);
    await c.goal([link(a, REL, 40)]);
    const [ga, gb] = await c.list();
    expect(ga.asset_funding).toBe(60000);
    expect(ga.assets[0]).toMatchObject({ asset_id: a.asset_id.toString(), match_type: REL, match_value: 60, funded: 60000 });
    expect(gb.asset_funding).toBe(40000);
    expect(ga.currently_funded_amount).toBe(60000);
  });

  test('over-allocating relative shares is a 400', async () => {
    const a = await c.asset(c.uid, 'Fund', 10_000_000);
    await c.goal([link(a, REL, 60)]);
    await c.goal([link(a, REL, 40)]);
    await expectThrowErrorCode(() => c.goal([link(a, REL, 10)]), 400);
  });

  test('absolute amounts are checked against the value, and freed when a goal drops its link', async () => {
    const a = await c.asset(c.uid, 'Fund', 10_000_000);
    await c.goal([link(a, REL, 60)]);
    await c.goal([link(a, REL, 40)]);
    await expectThrowErrorCode(() => c.goal([link(a, ABS, 30000)]), 400);
    const [, gb] = await c.list();
    await GoalService.updateGoal(
      {
        goal_id: BigInt(gb.goal_id),
        name: gb.name,
        priority: gb.priority,
        amount: gb.amount,
        is_archived: false,
        funding_accounts: [],
        funding_assets: [],
      },
      c.uid
    );
    await c.goal([link(a, ABS, 30000)]);
    const goals = await c.list();
    expect(goals[2].asset_funding).toBe(30000);
  });

  test('updating a goal does not count its own previous share', async () => {
    const a = await c.asset(c.uid, 'Fund', 10_000_000);
    await c.goal([link(a, REL, 100)]);
    const [g] = await c.list();
    await GoalService.updateGoal(
      { goal_id: BigInt(g.goal_id), name: g.name, priority: g.priority, amount: g.amount, is_archived: false, funding_accounts: [], funding_assets: [link(a, REL, 90)] },
      c.uid
    );
    expect((await c.list())[0].asset_funding).toBe(90000);
  });

  test('SIP is the 6-month average of buys times the share', async () => {
    const a = await c.asset(c.uid, 'Fund', 10_000_000);
    for (const m of [5, 6, 7, 8, 9, 10]) await c.buy(a.asset_id, { year: 2026, month: m }, 500000);
    await c.buy(a.asset_id, { year: 2026, month: 4 }, 900000); // outside the window
    await c.goal([link(a, REL, 60)]);
    await c.goal([link(a, ABS, 10000)], {});
    const [ga, gb] = await c.list();
    expect(ga.monthly_sip).toBe(3000);
    expect(gb.monthly_sip).toBe(500); // 5,000 x 10,000/100,000
  });

  test('on track against the due date and the expected return', async () => {
    const a = await c.asset(c.uid, 'Fund', 10_000_000);
    for (const m of [5, 6, 7, 8, 9, 10]) await c.buy(a.asset_id, { year: 2026, month: m }, 500000);
    const due = NOW + 365 * DAY;
    await c.goal([link(a, REL, 60)], { amount: 100000, due_date: due });
    await c.goal([link(a, REL, 40)], { amount: 500000, due_date: due });
    const [ga, gb] = await c.list();
    expect(ga.on_track).toBe(true);
    expect(gb.on_track).toBe(false);
    await c.goal([], { due_date: undefined });
    expect((await c.list())[2].on_track).toBeNull();
  });

  test('another user\'s asset is a 401', async () => {
    const theirs = await c.asset(c.other.user_id, 'Theirs', 100000);
    await expectThrowErrorCode(() => c.goal([link(theirs, REL, 10)]), 401);
  });

  test('a value below the allocated absolutes funds min(value, what is left) per goal, higher priority number first', async () => {
    const a = await c.asset(c.uid, 'Fund', 10_000_000);
    await c.goal([link(a, ABS, 60000)]);
    await c.goal([link(a, ABS, 40000)]);
    await prisma.invest_asset_evo_snapshot.updateMany({ data: { current_value: 5_000_000 } });
    const goals = await c.list();
    expect(goals.map((g) => g.asset_funding)).toEqual([10000, 40000]);
  });

  test('a JSON backup round-trip keeps the links', async () => {
    const a = await c.asset(c.uid, 'Fund', 10_000_000);
    await c.goal([link(a, REL, 60)]);
    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(c.uid)));
    expect(backup.goal_has_assets).toHaveLength(1);
    await UserService.restoreUser(c.uid, backup);
    const links = await prisma.goal_has_asset.findMany({ include: { invest_assets: true, goals: true } });
    expect(links).toHaveLength(1);
    expect(links[0].invest_assets.name).toBe('Fund');
    expect(links[0].invest_assets.users_user_id).toBe(c.uid);
    expect(Number(links[0].match_value)).toBe(60);
    // an old backup without the key restores cleanly
    delete backup.goal_has_assets;
    await UserService.restoreUser(c.uid, backup);
    expect(await prisma.goal_has_asset.count()).toBe(0);
  });
});
