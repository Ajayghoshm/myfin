import { performDatabaseRequest, prisma } from '../config/prisma.js';
import { MYFIN } from '../consts.js';
import APIError from '../errorHandling/apiError.js';
import ConvertUtils from '../utils/convertUtils.js';
import { getFinancialProfile } from './financialProfileService.js';
import { monthRangeIST, type YearMonth } from './insights/insightsPrimitives.js';
import { investValuesAt } from './wealth/netWorthService.js';

const IST_OFFSET_SECONDS = 19_800;
const SIP_WINDOW_MONTHS = 6;
const EPSILON = 0.005;

export type FundingType = 'absolute' | 'relative';

export type FundingAccount = {
  account_id: number;
  funding_type: FundingType;
  funding_amount: number;
  current_funding?: number;
};

export type FundingAsset = {
  asset_id: number;
  funding_type: FundingType;
  funding_amount: number;
};

export type GoalAssetFunding = {
  asset_id: string;
  match_type: string;
  match_value: number;
  funded: number;
};

export type CreateGoalType = {
  name: string;
  description?: string;
  priority: number;
  amount: number;
  due_date?: number;
  funding_accounts: FundingAccount[];
  funding_assets?: FundingAsset[];
};

export type UpdateGoalType = {
  goal_id: bigint;
  name: string;
  description?: string;
  priority: number;
  amount: number;
  due_date?: number;
  is_archived: boolean;
  funding_accounts: FundingAccount[];
  funding_assets?: FundingAsset[];
};

export type GoalWithFunding = {
  goal_id: number;
  name: string;
  description: string | null;
  priority: number;
  amount: number;
  due_date: number | null;
  is_archived: boolean;
  currently_funded_amount: number;
  funding_accounts: FundingAccount[];
  is_underfunded: boolean;
  is_underfunded_by_priority: boolean;
  assets: GoalAssetFunding[];
  asset_funding: number;
  monthly_sip: number;
  on_track: boolean | null;
};

export type GoalFundingSummary = {
  goals: GoalWithFunding[];
  unallocated_funding: {
    total_amount: number;
    accounts: Array<{
      account_id: number;
      amount: number;
    }>;
  };
  /** Per investment asset: current value not claimed by any goal (archived goals still claim their share). */
  unallocated_assets: Array<{ asset_id: string; value: number; amount: number }>;
};

const istYearMonth = (epochSeconds: number): YearMonth & { day: number; secondOfDay: number } => {
  const d = new Date((epochSeconds + IST_OFFSET_SECONDS) * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    secondOfDay: d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds(),
  };
};

/** Whole IST calendar months from `now` to `due` (negative once `due` has passed). */
const wholeMonthsBetween = (now: number, due: number): number => {
  const a = istYearMonth(now);
  const b = istYearMonth(due);
  let months = (b.year - a.year) * 12 + (b.month - a.month);
  if (b.day * 86400 + b.secondOfDay < a.day * 86400 + a.secondOfDay) months -= 1;
  return months;
};

/** Latest market value (currency) per asset. */
async function assetValues(userId: bigint, assetIds: bigint[], now: number): Promise<Map<string, number>> {
  const entries = await Promise.all(
    [...new Set(assetIds)].map(async (id) => {
      const [cents] = await investValuesAt(userId, [now + 1], [id]);
      return [id.toString(), ConvertUtils.convertBigIntegerToFloat(BigInt(Math.round(cents)))] as const;
    })
  );
  return new Map(entries);
}

class GoalService {
  private static async validateFundingAccountsBelongToUser(
    fundingAccounts: FundingAccount[],
    userId: bigint,
    dbClient: Pick<typeof prisma, 'accounts'> = prisma
  ) {
    const fundingAccountIds = [...new Set(fundingAccounts.map((fa) => BigInt(fa.account_id)))];

    if (fundingAccountIds.length === 0) {
      return;
    }

    const userAccountsCount = await dbClient.accounts.count({
      where: {
        account_id: {
          in: fundingAccountIds,
        },
        users_user_id: userId,
      },
    });

    if (userAccountsCount !== fundingAccountIds.length) {
      throw APIError.notAuthorized();
    }
  }

  private static async validateFundingAssets(
    fundingAssets: FundingAsset[],
    userId: bigint,
    excludeGoalId: bigint | null,
    dbClient: Pick<typeof prisma, 'invest_assets' | 'goal_has_asset'> = prisma,
    now = Math.floor(Date.now() / 1000)
  ) {
    const assetIds = [...new Set(fundingAssets.map((fa) => BigInt(fa.asset_id)))];
    if (assetIds.length === 0) return;

    const assets = await dbClient.invest_assets.findMany({
      where: { asset_id: { in: assetIds }, users_user_id: userId },
    });
    if (assets.length !== assetIds.length) {
      throw APIError.notAuthorized();
    }

    const values = await assetValues(userId, assetIds, now);
    const others = await dbClient.goal_has_asset.findMany({
      where: {
        invest_assets_asset_id: { in: assetIds },
        goals: { users_user_id: userId },
        ...(excludeGoalId === null ? {} : { goals_goal_id: { not: excludeGoalId } }),
      },
    });

    // Concurrency: this read-then-write check is not locked. MyFin is single-user per account, and
    // if two requests ever race, funding is clamped on read (see applyAssetFunding), so an
    // over-allocation can never inflate a goal.
    for (const asset of assets) {
      const value = values.get(asset.asset_id.toString()) ?? 0;
      const links = [
        ...others
          .filter((o) => o.invest_assets_asset_id === asset.asset_id)
          .map((o) => ({ type: o.match_type, value: Number(o.match_value) })),
        ...fundingAssets
          .filter((fa) => BigInt(fa.asset_id) === asset.asset_id)
          .map((fa) => ({ type: fa.funding_type as string, value: fa.funding_amount })),
      ];
      const relative = links
        .filter((l) => l.type === MYFIN.GOALS.MATCH_TYPE.RELATIVE)
        .reduce((total, l) => total + l.value, 0);
      const absolute = links
        .filter((l) => l.type === MYFIN.GOALS.MATCH_TYPE.ABSOLUTE)
        .reduce((total, l) => total + l.value, 0);

      if (relative > 100 + 1e-9) {
        throw APIError.badRequest(
          `Asset "${asset.name}" is over-allocated: the percentage shares across goals would add up to ${relative}%, above 100%`
        );
      }
      if ((relative * value) / 100 + absolute > value + EPSILON) {
        throw APIError.badRequest(
          `Asset "${asset.name}" is over-allocated: the goals' shares would add up to more than its current value of ${value.toFixed(2)}`
        );
      }
    }
  }

  static async createGoal(goal: CreateGoalType, userId: bigint, dbClient = prisma) {
    return performDatabaseRequest(async (prismaTx) => {
      await GoalService.validateFundingAccountsBelongToUser(
        goal.funding_accounts || [],
        userId,
        prismaTx
      );

      await GoalService.validateFundingAssets(goal.funding_assets || [], userId, null, prismaTx);

      const timestamp = Date.now();
      const goalObj = {
        name: goal.name,
        description: goal.description || null,
        priority: goal.priority,
        amount: ConvertUtils.convertFloatToBigInteger(goal.amount),
        due_date: goal.due_date ? BigInt(goal.due_date) : null,
        created_at: BigInt(timestamp),
        updated_at: BigInt(timestamp),
        users_user_id: userId,
      };

      const createdGoal = await prismaTx.goals.create({
        data: goalObj,
      });

      if (goal.funding_accounts && goal.funding_accounts.length > 0) {
        const fundingAccountsData = goal.funding_accounts.map((fa) => ({
          goals_goal_id: createdGoal.goal_id,
          accounts_account_id: BigInt(fa.account_id),
          match_type: fa.funding_type,
          match_value: fa.funding_amount,
        }));

        await prismaTx.goal_has_account.createMany({
          data: fundingAccountsData,
        });
      }

      if (goal.funding_assets && goal.funding_assets.length > 0) {
        await prismaTx.goal_has_asset.createMany({
          data: goal.funding_assets.map((fa) => ({
            goals_goal_id: createdGoal.goal_id,
            invest_assets_asset_id: BigInt(fa.asset_id),
            match_type: fa.funding_type,
            match_value: fa.funding_amount,
          })),
        });
      }

      return createdGoal;
    }, dbClient);
  }

  static async getGoalsForUser(
    userId: bigint,
    onlyActive = false,
    dbClient = prisma,
    now = Math.floor(Date.now() / 1000)
  ): Promise<GoalFundingSummary> {
    const whereClause: { users_user_id: bigint; is_archived?: boolean } = {
      users_user_id: userId,
    };

    if (onlyActive) {
      whereClause.is_archived = false;
    }

    const goals = await dbClient.goals.findMany({
      where: whereClause,
      include: {
        goal_has_account: {
          include: {
            accounts: true,
          },
          orderBy: {
            accounts_account_id: 'asc',
          },
        },
      },
      orderBy: [{ priority: 'desc' }, { goal_id: 'asc' }],
    });

    // Get all accounts for the user to calculate funding
    const accounts = await dbClient.accounts.findMany({
      where: {
        users_user_id: userId,
      },
    });

    const accountBalances = new Map<bigint, number>();
    for (const account of accounts) {
      accountBalances.set(
        account.account_id,
        ConvertUtils.convertBigIntegerToFloat(account.current_balance || BigInt(0))
      );
    }

    const goalsWithFunding: GoalWithFunding[] = goals.map((goal) => ({
      goal_id: Number(goal.goal_id),
      name: goal.name,
      description: goal.description,
      priority: goal.priority,
      amount: ConvertUtils.convertBigIntegerToFloat(goal.amount),
      due_date: goal.due_date ? Number(goal.due_date) : null,
      is_archived: goal.is_archived,
      currently_funded_amount: 0,
      funding_accounts: goal.goal_has_account.map((gha) => ({
        account_id: Number(gha.accounts_account_id),
        funding_type: gha.match_type as FundingType,
        funding_amount: Number(gha.match_value),
        current_funding: 0,
      })),
      is_underfunded: false,
      is_underfunded_by_priority: false,
      assets: [],
      asset_funding: 0,
      monthly_sip: 0,
      on_track: null,
    }));

    const accountFundingTracking = new Map<bigint, number>();
    const accountFundingByPriority = new Map<bigint, Map<number, number>>();
    const accountGoalIndexes = new Map<bigint, number[]>();
    const getConfiguredFundingAmount = (
      gha: (typeof goals)[number]['goal_has_account'][number]
    ) => {
      const accountBalance = accountBalances.get(gha.accounts_account_id) || 0;

      if (gha.match_type === MYFIN.GOALS.MATCH_TYPE.RELATIVE) {
        return (accountBalance * Number(gha.match_value)) / 100;
      }

      return Number(gha.match_value);
    };
    const getLowerPriorityFundingDemand = (accountId: bigint, currentGoalIndex: number) => {
      let lowerPriorityFundingDemand = 0;

      for (const lowerPriorityGoal of goals.slice(currentGoalIndex + 1)) {
        const lowerPriorityGoalAmount = ConvertUtils.convertBigIntegerToFloat(
          lowerPriorityGoal.amount
        );
        const matchingFundingAccount = lowerPriorityGoal.goal_has_account.find(
          (gha) => gha.accounts_account_id === accountId
        );

        if (matchingFundingAccount) {
          lowerPriorityFundingDemand += Math.min(
            getConfiguredFundingAmount(matchingFundingAccount),
            lowerPriorityGoalAmount
          );
        }
      }

      return lowerPriorityFundingDemand;
    };

    for (const [goalIndex, goal] of goals.entries()) {
      for (const gha of goal.goal_has_account) {
        const goalIndexes = accountGoalIndexes.get(gha.accounts_account_id) || [];
        goalIndexes.push(goalIndex);
        accountGoalIndexes.set(gha.accounts_account_id, goalIndexes);
      }
    }

    for (const [goalIndex, goal] of goals.entries()) {
      const goalWithFunding = goalsWithFunding[goalIndex];
      const fundingEntries = goal.goal_has_account
        .map((gha, fundingAccountIndex) => ({
          fundingAccountIndex,
          gha,
          lowerPriorityFundingDemand: getLowerPriorityFundingDemand(
            gha.accounts_account_id,
            goalIndex
          ),
        }))
        .sort((a, b) => {
          const demandDifference = a.lowerPriorityFundingDemand - b.lowerPriorityFundingDemand;

          if (demandDifference !== 0) {
            return demandDifference;
          }

          return Number(a.gha.accounts_account_id - b.gha.accounts_account_id);
        });

      for (const { fundingAccountIndex, gha } of fundingEntries) {
        const accountBalance = accountBalances.get(gha.accounts_account_id) || 0;
        const alreadyAllocated = accountFundingTracking.get(gha.accounts_account_id) || 0;
        const remainingBalance = Math.max(0, accountBalance - alreadyAllocated);
        const remainingGoalAmount = Math.max(
          0,
          goalWithFunding.amount - goalWithFunding.currently_funded_amount
        );

        const fundingAmount = getConfiguredFundingAmount(gha);
        const actualFunding = Math.min(fundingAmount, remainingBalance, remainingGoalAmount);

        const allocationsByPriority =
          accountFundingByPriority.get(gha.accounts_account_id) || new Map<number, number>();
        const higherPriorityFunding = [...allocationsByPriority.entries()].reduce(
          (total, [priority, allocated]) => (priority > goal.priority ? total + allocated : total),
          0
        );
        const balanceWithoutHigherPriorityFunding = Math.max(
          0,
          accountBalance - (alreadyAllocated - higherPriorityFunding)
        );
        const fundingWithoutHigherPriorityGoals = Math.min(
          fundingAmount,
          balanceWithoutHigherPriorityFunding,
          remainingGoalAmount
        );

        if (fundingWithoutHigherPriorityGoals > actualFunding) {
          goalWithFunding.is_underfunded_by_priority = true;
        }

        goalWithFunding.currently_funded_amount += actualFunding;

        // Track allocated funds
        accountFundingTracking.set(gha.accounts_account_id, alreadyAllocated + actualFunding);
        allocationsByPriority.set(
          goal.priority,
          (allocationsByPriority.get(goal.priority) || 0) + actualFunding
        );
        accountFundingByPriority.set(gha.accounts_account_id, allocationsByPriority);
        goalWithFunding.funding_accounts[fundingAccountIndex].current_funding = actualFunding;
      }
    }

    const unallocatedFundingAccounts: GoalFundingSummary['unallocated_funding']['accounts'] = [];

    for (const accountId of accountGoalIndexes.keys()) {
      const accountBalance = accountBalances.get(accountId) || 0;
      const alreadyAllocated = accountFundingTracking.get(accountId) || 0;
      const remainingBalance = Math.max(0, accountBalance - alreadyAllocated);

      if (remainingBalance <= 0) {
        continue;
      }

      unallocatedFundingAccounts.push({
        account_id: Number(accountId),
        amount: remainingBalance,
      });
    }

    const accountFunding = goalsWithFunding.map((g) => g.currently_funded_amount);
    const unallocatedAssets = await GoalService.applyAssetFunding(
      userId,
      goalsWithFunding,
      now,
      dbClient
    );

    const expectedReturnPct = goalsWithFunding.some((g) => g.due_date !== null)
      ? (await getFinancialProfile(userId)).expected_return_pct
      : 0;
    for (const [index, goal] of goalsWithFunding.entries()) {
      goal.on_track = GoalService.isOnTrack(
        goal,
        accountFunding[index] + goal.asset_funding,
        expectedReturnPct,
        now
      );
    }

    for (const goal of goalsWithFunding) {
      goal.is_underfunded = goal.currently_funded_amount < goal.amount;
      goal.is_underfunded_by_priority = goal.is_underfunded && goal.is_underfunded_by_priority;
    }

    return {
      goals: goalsWithFunding,
      unallocated_funding: {
        total_amount: unallocatedFundingAccounts.reduce(
          (total, account) => total + account.amount,
          0
        ),
        accounts: unallocatedFundingAccounts,
      },
      unallocated_assets: unallocatedAssets,
    };
  }

  /**
   * Fills each listed goal's asset links, funding, SIP; returns each asset's unallocated value.
   *
   * Funding per link = value x pct / 100 (relative) or min(value, amount) (absolute). Links are
   * walked per asset in goal priority order (higher number first, like accounts); if the value has
   * dropped below the allocated absolutes, a link gets min(configured, what is left), so the lowest
   * priorities lose first. Archived goals still hold their share, so they count here too.
   */
  private static async applyAssetFunding(
    userId: bigint,
    goalsWithFunding: GoalWithFunding[],
    now: number,
    dbClient = prisma
  ) {
    const links = await dbClient.goal_has_asset.findMany({
      where: { goals: { users_user_id: userId } },
      include: { goals: { select: { priority: true, goal_id: true, amount: true } } },
    });
    const assets = await dbClient.invest_assets.findMany({
      where: { users_user_id: userId },
      select: { asset_id: true },
    });
    const values = await assetValues(
      userId,
      assets.map((a) => a.asset_id),
      now
    );

    // Average monthly buys over the last full IST months
    const nowMonth = istYearMonth(now);
    const first = monthRangeIST({ year: nowMonth.year, month: nowMonth.month - SIP_WINDOW_MONTHS });
    const windowEnd = monthRangeIST(nowMonth).from;
    const buys = await dbClient.invest_transactions.groupBy({
      by: ['invest_assets_asset_id'],
      where: {
        type: 'B',
        date_timestamp: { gte: BigInt(first.from), lt: BigInt(windowEnd) },
        invest_assets: { users_user_id: userId },
      },
      _sum: { total_price: true },
    });
    const monthlyBuys = new Map(
      buys.map((b) => [
        b.invest_assets_asset_id.toString(),
        ConvertUtils.convertBigIntegerToFloat(BigInt(b._sum.total_price ?? 0)) / SIP_WINDOW_MONTHS,
      ])
    );

    const goalById = new Map(goalsWithFunding.map((g) => [BigInt(g.goal_id), g]));
    const claimed = new Map<string, number>();
    const byAsset = new Map<string, typeof links>();
    for (const link of links) {
      const list = byAsset.get(link.invest_assets_asset_id.toString()) ?? [];
      list.push(link);
      byAsset.set(link.invest_assets_asset_id.toString(), list);
    }

    for (const [assetId, assetLinks] of byAsset) {
      const value = values.get(assetId) ?? 0;
      assetLinks.sort(
        (a, b) => b.goals.priority - a.goals.priority || Number(a.goals_goal_id - b.goals_goal_id)
      );
      let remaining = value;
      for (const link of assetLinks) {
        const matchValue = Number(link.match_value);
        const isRelative = link.match_type === MYFIN.GOALS.MATCH_TYPE.RELATIVE;
        const goal = goalById.get(link.goals_goal_id);
        const configured = isRelative
          ? (value * matchValue) / 100
          : Math.min(value, matchValue);
        // Like account funding: capped by what is left of the asset and of the goal's amount
        // (after its account funding); the surplus stays unallocated.
        const goalAmount = ConvertUtils.convertBigIntegerToFloat(link.goals.amount);
        const goalRemaining = Math.max(
          0,
          goalAmount - (goal ? goal.currently_funded_amount : 0)
        );
        const funded = Math.max(0, Math.min(configured, remaining, goalRemaining));
        remaining -= funded;
        claimed.set(assetId, (claimed.get(assetId) ?? 0) + funded);

        if (!goal) continue;
        const share = isRelative ? matchValue / 100 : value > 0 ? Math.min(matchValue, value) / value : 0;
        goal.assets.push({
          asset_id: assetId,
          match_type: link.match_type,
          match_value: matchValue,
          funded,
        });
        goal.asset_funding += funded;
        goal.currently_funded_amount += funded;
        goal.monthly_sip += (monthlyBuys.get(assetId) ?? 0) * share;
      }
    }

    for (const goal of goalsWithFunding) {
      goal.assets.sort((a, b) => Number(BigInt(a.asset_id) - BigInt(b.asset_id)));
    }

    return assets
      .map((a) => {
        const id = a.asset_id.toString();
        const value = values.get(id) ?? 0;
        return { asset_id: id, value, amount: Math.max(0, value - (claimed.get(id) ?? 0)) };
      })
      .filter((a) => a.value > 0);
  }

  /** Funding now (accounts + assets) plus the SIP, grown monthly at the expected return, vs the amount. */
  private static isOnTrack(
    goal: GoalWithFunding,
    fundingNow: number,
    expectedReturnPct: number,
    now: number
  ): boolean | null {
    if (goal.due_date === null) return null;
    const months = wholeMonthsBetween(now, goal.due_date);
    if (months <= 0) return fundingNow + EPSILON >= goal.amount;

    const m = expectedReturnPct / 12 / 100;
    const projected =
      m === 0
        ? fundingNow + goal.monthly_sip * months
        : fundingNow * (1 + m) ** months + (goal.monthly_sip * ((1 + m) ** months - 1)) / m;
    return projected + EPSILON >= goal.amount;
  }

  static async doesGoalBelongToUser(userId: bigint, goalId: bigint, dbClient = prisma) {
    const result = await dbClient.goals.findUnique({
      where: {
        goal_id: goalId,
        users_user_id: userId,
      },
    });

    return result !== null;
  }

  static async deleteGoal(goalId: bigint, dbClient = prisma) {
    return dbClient.$transaction(async (tx) => {
      // Delete funding accounts first
      await tx.goal_has_account.deleteMany({
        where: { goals_goal_id: goalId },
      });
      await tx.goal_has_asset.deleteMany({
        where: { goals_goal_id: goalId },
      });

      // Delete the goal
      await tx.goals.delete({
        where: { goal_id: goalId },
      });
    });
  }

  static async updateGoal(goal: UpdateGoalType, userId: bigint, dbClient = prisma) {
    const timestamp = Date.now();
    const goalObj = {
      name: goal.name,
      description: goal.description || null,
      priority: goal.priority,
      amount: ConvertUtils.convertFloatToBigInteger(goal.amount),
      due_date: goal.due_date ? BigInt(goal.due_date) : null,
      is_archived: goal.is_archived ?? false,
      updated_at: BigInt(timestamp),
    };

    return dbClient.$transaction(async (tx) => {
      await GoalService.validateFundingAccountsBelongToUser(
        goal.funding_accounts || [],
        userId,
        tx
      );

      await GoalService.validateFundingAssets(goal.funding_assets || [], userId, goal.goal_id, tx);

      // Update the goal
      const updatedGoal = await tx.goals.update({
        where: { goal_id: goal.goal_id },
        data: goalObj,
      });

      // Delete existing funding accounts
      await tx.goal_has_account.deleteMany({
        where: { goals_goal_id: goal.goal_id },
      });

      // Create new funding accounts
      if (goal.funding_accounts && goal.funding_accounts.length > 0) {
        const fundingAccountsData = goal.funding_accounts.map((fa) => ({
          goals_goal_id: goal.goal_id,
          accounts_account_id: BigInt(fa.account_id),
          match_type: fa.funding_type,
          match_value: fa.funding_amount,
        }));

        await tx.goal_has_account.createMany({
          data: fundingAccountsData,
        });
      }

      // Replace the asset links (an omitted list keeps them)
      if (goal.funding_assets) {
        await tx.goal_has_asset.deleteMany({ where: { goals_goal_id: goal.goal_id } });
        if (goal.funding_assets.length > 0) {
          await tx.goal_has_asset.createMany({
            data: goal.funding_assets.map((fa) => ({
              goals_goal_id: goal.goal_id,
              invest_assets_asset_id: BigInt(fa.asset_id),
              match_type: fa.funding_type,
              match_value: fa.funding_amount,
            })),
          });
        }
      }

      return updatedGoal;
    });
  }

  static async getCountOfUserGoals(userId: bigint, dbClient = prisma) {
    return dbClient.goals.count({
      where: { users_user_id: userId },
    });
  }
}

export default GoalService;
