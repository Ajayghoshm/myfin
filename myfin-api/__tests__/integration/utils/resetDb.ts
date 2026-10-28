import { prisma } from '../../../src/config/prisma.js';

export default async () => {
  await prisma.$transaction([
    prisma.transaction_has_tags.deleteMany(),
    prisma.debt_payments.deleteMany(),
    prisma.transactions.deleteMany(),
    prisma.debts.deleteMany(),
    prisma.balances_snapshot.deleteMany(),
    prisma.budgets_has_categories.deleteMany(),
    prisma.goal_has_asset.deleteMany(),
    prisma.invest_asset_evo_snapshot.deleteMany(),
    prisma.invest_desired_allocations.deleteMany(),
    prisma.invest_transactions.deleteMany(),
    prisma.invest_assets.deleteMany(),
    prisma.rules.deleteMany(),
    prisma.tags.deleteMany(),
    prisma.categories.deleteMany(),
    prisma.entities.deleteMany(),
    prisma.budgets.deleteMany(),
    prisma.import_instrument_mappings.deleteMany(),
    prisma.goal_has_account.deleteMany(),
    prisma.goals.deleteMany(),
    prisma.balance_checks.deleteMany(),
    prisma.legacy_entries.deleteMany(),
    prisma.monthly_records.deleteMany(),
    prisma.accounts.deleteMany(),
    prisma.otp_codes.deleteMany(),
    prisma.payee_classifications.deleteMany(),
    prisma.user_financial_profile.deleteMany(),
    prisma.users.deleteMany(),
  ]);
};
