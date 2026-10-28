import { prisma } from '../../config/prisma.js';
import { MYFIN } from '../../consts.js';
import { addRepayment, createPeopleDebt } from '../../services/debts/debtService.js';
import {
  createLoan,
  markPastInstallmentsPaid,
  matchInstallment,
} from '../../services/debts/loanService.js';
import { updateFinancialProfile } from '../../services/financialProfileService.js';
import GoalService, { type FundingType } from '../../services/goalService.js';
import { monthRangeIST } from '../../services/insights/insightsPrimitives.js';
import { createEntry } from '../../services/legacyService.js';
import { validateLegacyData } from '../../services/legacyValidation.js';
import { confirmMatch } from '../../services/planning/plannedTransactionService.js';
import {
  type BucketName,
  confirmSalaryPlan,
  currentSalaryPlan,
} from '../../services/planning/salaryPlanService.js';
import { createYearlyCost } from '../../services/planning/yearlyCostService.js';
import { addDays, clampedDate } from '../../services/routines/eventDates.js';
import { createEvent, linkTransaction } from '../../services/routines/eventService.js';
import { balancesAt } from '../../services/wealth/netWorthService.js';
import {
  CAR_INSURANCE,
  type DemoCalendar,
  FIRST_OFFSET,
  LIC_PREMIUM,
  LOAN,
  SAVINGS_TRANSFER,
  SINKING_TRANSFER,
  dayEpoch,
  installmentFor,
  monthAt,
} from './dataset.js';
import type { DemoLedger } from './ledger.js';

/**
 * The parts of the demo built through feature services that open their own transactions on the
 * global client, so they run after the ledger has committed, one after another.
 */

const ymd = (ym: { year: number; month: number }, day: number) =>
  clampedDate(ym.year, ym.month, day);

function need(ledger: DemoLedger, key: string): bigint {
  const id = ledger.trx.get(key);
  if (id == null) throw new Error(`Demo data: missing transaction ${key}`);
  return id;
}

async function setProfile(userId: bigint, ledger: DemoLedger) {
  // SBI Savings is the emergency fund and an account holds one earmark, so the savings target has
  // no account of its own; the monthly ₹20,000 into SBI Savings is the plan's emergency bucket.
  await updateFinancialProfile(userId, {
    salary_category_id: ledger.categories.salary,
    salary_cutoff_day: 25,
    savings_target_mode: 'amount',
    savings_target_value: SAVINGS_TRANSFER,
    sinking_fund_account_id: ledger.accounts.sinking,
    emergency_fund_target_months: 6,
    emergency_topup_percent: 10,
    small_spend_cutoff: 200,
    date_of_birth: '1991-06-14',
    retirement_age: 60,
    // An investment account cannot be earmarked; its assets carry the retirement tick
    retirement_asset_ids: [ledger.assets.nifty, ledger.assets.ppf],
  });
}

/** The home loan, its EMIs in the demo months matched to the bank debits, older ones marked paid. */
async function createHomeLoan(userId: bigint, cal: DemoCalendar, ledger: DemoLedger) {
  const loan = await createLoan(
    userId,
    {
      lender: LOAN.lender,
      principal: LOAN.principal,
      rate: LOAN.rate,
      tenure_months: LOAN.tenureMonths,
      emi_day: LOAN.emiDay,
      account_id: ledger.accounts.salary,
      start_date: dayEpoch(monthAt(cal, LOAN.startOffset), 1),
    },
    cal.now
  );
  const debtId = BigInt(loan.debt_id);
  for (let k = FIRST_OFFSET; k <= 0; k++) {
    const trxId = ledger.trx.get(`emi:${k}`);
    if (trxId != null) await matchInstallment(userId, debtId, installmentFor(k), trxId, cal.now);
  }
  await markPastInstallmentsPaid(userId, debtId, cal.now);
}

async function createPeopleDebts(userId: bigint, cal: DemoCalendar, ledger: DemoLedger) {
  const arjun = await createPeopleDebt(
    userId,
    {
      kind: 'lent',
      name: 'Arjun',
      transaction_id: need(ledger, 'arjun:lend'),
      note: 'For his bike repair',
    },
    cal.now
  );
  await addRepayment(userId, BigInt(arjun.debt_id), {
    transaction_id: need(ledger, 'arjun:repay'),
  });
  const meera = await createPeopleDebt(
    userId,
    { kind: 'borrowed', name: 'Meera', transaction_id: need(ledger, 'meera:borrow') },
    cal.now
  );
  await addRepayment(userId, BigInt(meera.debt_id), {
    transaction_id: need(ledger, 'meera:repay'),
  });
}

async function createYearlyCosts(userId: bigint, cal: DemoCalendar, ledger: DemoLedger) {
  await createYearlyCost(
    userId,
    {
      name: 'LIC premium',
      amount: LIC_PREMIUM,
      due_month: monthAt(cal, -4).month,
      category_id: ledger.categories.insurance,
      link_transaction_id: need(ledger, 'lic'),
    },
    cal.now
  );
  await createYearlyCost(
    userId,
    {
      name: 'Car insurance',
      amount: CAR_INSURANCE,
      due_month: monthAt(cal, 3).month,
      category_id: ledger.categories.insurance,
    },
    cal.now
  );
}

async function createGoals(userId: bigint, ledger: DemoLedger) {
  await GoalService.createGoal(
    {
      name: 'Goa trip',
      description: 'December holiday with the family',
      priority: 1,
      amount: 60_000,
      funding_accounts: [
        {
          account_id: Number(ledger.accounts.savings),
          funding_type: MYFIN.GOALS.MATCH_TYPE.ABSOLUTE as FundingType,
          funding_amount: 40_000,
        },
      ],
    },
    userId
  );
  await GoalService.createGoal(
    {
      name: 'Child education',
      description: 'College fund',
      priority: 2,
      amount: 1_500_000,
      funding_accounts: [],
      funding_assets: [
        {
          asset_id: Number(ledger.assets.nifty),
          funding_type: MYFIN.GOALS.MATCH_TYPE.RELATIVE as FundingType,
          funding_amount: 40,
        },
      ],
    },
    userId
  );
}

async function createEvents(userId: bigint, cal: DemoCalendar, ledger: DemoLedger) {
  const birthday = addDays(cal.today, 20);
  const lastYear = `${Number(birthday.slice(0, 4)) - 1}${birthday.slice(4, 10).replace('-02-29', '-02-28')}`;
  await createEvent(
    userId,
    {
      name: "Amma's birthday",
      kind: 'birthday',
      date: lastYear,
      repeat: 'yearly',
      gift_budget: 3_000,
    },
    cal.now
  );
  await createEvent(
    userId,
    {
      name: "Rahul's wedding",
      kind: 'wedding',
      date: addDays(cal.today, 12),
      repeat: 'once',
      gift_budget: 5_001,
    },
    cal.now
  );
  const cardDue = await createEvent(
    userId,
    {
      name: 'HDFC Credit Card due',
      kind: 'card_due',
      date: ymd(monthAt(cal, FIRST_OFFSET), 3),
      repeat: 'monthly',
      account_id: ledger.accounts.card,
    },
    cal.now
  );
  await createEvent(
    userId,
    {
      name: 'Car insurance renewal',
      kind: 'renewal',
      date: ymd(monthAt(cal, 3), 10),
      repeat: 'yearly',
      amount: CAR_INSURANCE,
      category_id: ledger.categories.insurance,
    },
    cal.now
  );
  const lastBill = ledger.trx.get('cardbill:-1');
  if (lastBill != null)
    await linkTransaction(
      userId,
      BigInt(cardDue.event_id),
      ymd(monthAt(cal, -1), 3),
      lastBill,
      cal.now
    );
}

async function createLegacy(userId: bigint, ledger: DemoLedger) {
  const entries = [
    {
      kind: 'account' as const,
      account_id: String(ledger.accounts.salary),
      data: {
        bank_branch: 'HDFC Bank, MG Road branch',
        nominee: 'Priya (wife)',
        documents_location: 'Blue folder, bedroom cupboard',
      },
    },
    {
      kind: 'account' as const,
      account_id: String(ledger.accounts.invest),
      data: {
        bank_branch: 'Zerodha demat (CDSL)',
        nominee: 'Priya (wife)',
        documents_location: 'Contract notes in email',
      },
    },
    {
      kind: 'policy' as const,
      data: {
        insurer: 'LIC of India',
        policy_number: 'DEMO-4471-2093',
        sum_assured: 2_500_000,
        nominee: 'Priya (wife)',
        claim_helpline: '1800 000 0000',
        documents_location: 'Bank locker',
      },
    },
    {
      kind: 'instruction' as const,
      data: {
        text: 'The home loan has a cover policy: ask HDFC to close the loan from it. Car papers are in the glovebox.',
      },
    },
  ];
  for (const e of entries) {
    const data = await validateLegacyData(e.kind, e.data);
    await createEntry(userId, {
      kind: e.kind,
      account_id: 'account_id' in e ? e.account_id : null,
      data,
    });
  }
}

/**
 * A matched balance check at the end of last month on every bank, card and investment account.
 * Written directly: the balance-check service only records checks dated now.
 */
async function createBalanceChecks(cal: DemoCalendar, ledger: DemoLedger) {
  const checkedAt = monthRangeIST(monthAt(cal, -1)).to - 3600;
  const ids = Object.values(ledger.accounts);
  const balances = await balancesAt(ids, [checkedAt + 1]);
  for (const id of ids) {
    const raw = balances.get(id.toString())?.[0] ?? 0;
    const owed = id === ledger.accounts.card ? -raw : raw;
    await prisma.balance_checks.create({
      data: {
        accounts_account_id: id,
        checked_at: checkedAt,
        real_balance: owed,
        myfin_balance: owed,
        result: 'matched',
      },
    });
  }
}

/**
 * Confirms the salary plan the app proposes now: fixed costs as proposed, the sinking-fund and
 * emergency-fund transfers, the rest free to spend. Transfers already made are matched to it.
 */
async function confirmCurrentSalaryPlan(userId: bigint, cal: DemoCalendar, ledger: DemoLedger) {
  const proposal = await currentSalaryPlan(userId, cal.now);
  if (proposal.state !== 'proposal' || !proposal.salary || !proposal.month) return;
  const fixed = proposal.buckets.find((b) => b.bucket === 'fixed')?.amount ?? 0;
  const buckets: Array<{ bucket: BucketName; amount: number; account_to_id: bigint | null }> = [
    { bucket: 'fixed', amount: fixed, account_to_id: null },
    { bucket: 'yearly', amount: SINKING_TRANSFER, account_to_id: ledger.accounts.sinking },
    { bucket: 'emergency', amount: SAVINGS_TRANSFER, account_to_id: ledger.accounts.savings },
    { bucket: 'savings', amount: 0, account_to_id: null },
  ];
  const planId = await confirmSalaryPlan(userId, {
    month: proposal.month,
    salary_transaction_id: BigInt(proposal.salary.transaction_id),
    buckets,
  });

  const planned = await prisma.planned_transactions.findMany({ where: { salary_plan_id: planId } });
  const [year, month] = proposal.month.split('-').map(Number);
  const k = (year - cal.current.year) * 12 + (month - cal.current.month);
  for (const p of planned) {
    const trxId = ledger.trx.get(`${p.bucket === 'yearly' ? 'sinking' : 'savings'}:${k}`);
    if (trxId != null) await confirmMatch(userId, p.planned_id, trxId);
  }
}

export async function createFeatures(
  userId: bigint,
  cal: DemoCalendar,
  ledger: DemoLedger
): Promise<void> {
  await setProfile(userId, ledger);
  await createHomeLoan(userId, cal, ledger);
  await createPeopleDebts(userId, cal, ledger);
  await createYearlyCosts(userId, cal, ledger);
  await createGoals(userId, ledger);
  await createEvents(userId, cal, ledger);
  await createLegacy(userId, ledger);
  await createBalanceChecks(cal, ledger);
  await confirmCurrentSalaryPlan(userId, cal, ledger);
}
