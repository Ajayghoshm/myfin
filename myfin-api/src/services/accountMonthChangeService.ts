import { prisma } from '../config/prisma.js';
import { MYFIN } from '../consts.js';
import { IST_OFFSET_SECONDS, monthRangeIST } from './insights/insightsPrimitives.js';
import { balancesAt } from './wealth/netWorthService.js';

const OPERATING_TYPES: string[] = [
  MYFIN.ACCOUNT_TYPES.CHECKING,
  MYFIN.ACCOUNT_TYPES.SAVINGS,
  MYFIN.ACCOUNT_TYPES.MEAL,
  MYFIN.ACCOUNT_TYPES.WALLET,
];
const DEBT_TYPES: string[] = [MYFIN.ACCOUNT_TYPES.CREDIT, MYFIN.ACCOUNT_TYPES.LOAN];

/**
 * How much the top-bar figures (same account grouping as the web TopSummary) moved during the current
 * IST month, in currency units: Σ over the bucket's accounts of the transactions dated in the month.
 */
export async function getCurrentMonthChange(userId: bigint, now: number = Math.floor(Date.now() / 1000)) {
  const d = new Date((now + IST_OFFSET_SECONDS) * 1000);
  const { from, to } = monthRangeIST({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  const accounts = await prisma.accounts.findMany({
    where: { users_user_id: userId },
    select: { account_id: true, type: true },
  });
  const balances = await balancesAt(
    accounts.map((a) => a.account_id),
    [from, to]
  );
  const changeOf = (include: (type: string) => boolean) =>
    accounts
      .filter((a) => include(a.type))
      .reduce((sum, a) => {
        const [start, end] = balances.get(a.account_id.toString()) ?? [0, 0];
        return sum + (end - start);
      }, 0) / 100;

  return {
    from,
    to,
    operatingFunds: changeOf((t) => OPERATING_TYPES.includes(t)),
    investing: changeOf((t) => t === MYFIN.ACCOUNT_TYPES.INVESTING),
    debt: changeOf((t) => DEBT_TYPES.includes(t)),
    netWorth: changeOf(() => true),
  };
}

export default { getCurrentMonthChange };
