import express from 'express';
import type { Express, RequestHandler } from 'express-serve-static-core';
import AccountController from '../controllers/accountController.js';
import BalanceCheckController from '../controllers/balanceCheckController.js';
import BudgetController from '../controllers/budgetController.js';
import CategoryController from '../controllers/categoryController.js';
import DebtController from '../controllers/debtController.js';
import LoanController from '../controllers/loanController.js';
import EntityController from '../controllers/entityController.js';
import FinancialProfileController from '../controllers/financialProfileController.js';
import GoalController from '../controllers/goalController.js';
import InsightsController from '../controllers/insightsController.js';
import InvestAssetsController from '../controllers/investAssetsController.js';
import InvestReportsController from '../controllers/investReportsController.js';
import InvestTransactionsController from '../controllers/investTransactionsController.js';
import PlannedTransactionController from '../controllers/plannedTransactionController.js';
import SalaryPlanController from '../controllers/salaryPlanController.js';
import RuleController from '../controllers/ruleController.js';
import SetupController from '../controllers/setupController.js';
import StatsController from '../controllers/statsController.js';
import TagController from '../controllers/tagController.js';
import TransactionController from '../controllers/transactionController.js';
import UserController from '../controllers/userController.js';
import YearlyCostController from '../controllers/yearlyCostController.js';

export type RouteMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

type ControllerModule = Record<string, RequestHandler>;

export type RouteDefinition = {
  method: RouteMethod;
  path: string;
  handlerName: string;
};

export type RouteGroup = {
  tag: string;
  basePath: string;
  controller: ControllerModule;
  controllerSourceBaseUrl: string;
  routes: RouteDefinition[];
};

export const routeGroups: RouteGroup[] = [
  {
    tag: 'Users',
    basePath: '/users',
    controller: UserController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/userController', import.meta.url).href,
    routes: [
      { method: 'post', path: '/', handlerName: 'createOne' },
      { method: 'put', path: '/changePW/', handlerName: 'changeUserPassword' },
      { method: 'post', path: '/demo/', handlerName: 'autoPopulateDemoData' },
      { method: 'put', path: '/changeCurrency', handlerName: 'changeCurrency' },
    ],
  },
  {
    tag: 'User Data',
    basePath: '/user',
    controller: UserController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/userController', import.meta.url).href,
    routes: [
      {
        method: 'get',
        path: '/categoriesEntitiesTags',
        handlerName: 'getUserCategoriesAndEntities',
      },
      { method: 'get', path: '/backup', handlerName: 'backupUser' },
      { method: 'put', path: '/restore', handlerName: 'restoreUser' },
      { method: 'get', path: '/folder-backups', handlerName: 'listFolderBackups' },
      { method: 'post', path: '/folder-backups', handlerName: 'createFolderBackup' },
      { method: 'post', path: '/folder-backups/restore', handlerName: 'restoreFolderBackup' },
    ],
  },
  {
    tag: 'Financial Profile',
    basePath: '/user',
    controller: FinancialProfileController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/financialProfileController', import.meta.url)
      .href,
    routes: [
      { method: 'get', path: '/financial-profile', handlerName: 'getFinancialProfile' },
      { method: 'put', path: '/financial-profile', handlerName: 'updateFinancialProfile' },
    ],
  },
  {
    tag: 'Auth',
    basePath: '/auth',
    controller: UserController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/userController', import.meta.url).href,
    routes: [
      { method: 'post', path: '/', handlerName: 'attemptLogin' },
      { method: 'post', path: '/recovery/sendOtp', handlerName: 'sendOtpForRecovery' },
      { method: 'post', path: '/recovery/setNewPassword', handlerName: 'setNewPassword' },
    ],
  },
  {
    tag: 'Session',
    basePath: '/validity',
    controller: UserController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/userController', import.meta.url).href,
    routes: [{ method: 'post', path: '/', handlerName: 'checkSessionValidity' }],
  },
  {
    tag: 'Insights',
    basePath: '/insights',
    controller: InsightsController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/insightsController', import.meta.url).href,
    routes: [
      { method: 'get', path: '/month', handlerName: 'getMonthInsights' },
      { method: 'get', path: '/emergency-fund', handlerName: 'getEmergencyFund' },
      { method: 'get', path: '/safe-to-spend', handlerName: 'getSafeToSpend' },
      { method: 'get', path: '/small-spends', handlerName: 'getSmallSpends' },
      { method: 'get', path: '/daily', handlerName: 'getDailySpend' },
      { method: 'get', path: '/forecast', handlerName: 'getForecast' },
      { method: 'get', path: '/forecast/budget-compare', handlerName: 'getForecastBudgetCompare' },
      { method: 'post', path: '/forecast/budget', handlerName: 'createBudgetFromForecast' },
      { method: 'put', path: '/payee-classification', handlerName: 'setPayeeClassification' },
    ],
  },
  {
    tag: 'Planned Transactions',
    basePath: '/planned-transactions',
    controller: PlannedTransactionController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/plannedTransactionController', import.meta.url).href,
    routes: [
      { method: 'get', path: '/', handlerName: 'getPlanned' },
      { method: 'get', path: '/matches', handlerName: 'getMatches' },
      { method: 'get', path: '/:id/candidates', handlerName: 'getCandidates' },
      { method: 'post', path: '/:id/done', handlerName: 'markDone' },
      { method: 'post', path: '/:id/skip', handlerName: 'skipPlanned' },
      { method: 'post', path: '/:id/match', handlerName: 'confirmMatch' },
    ],
  },
  {
    tag: 'Salary Plan',
    basePath: '/salary-plan',
    controller: SalaryPlanController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/salaryPlanController', import.meta.url).href,
    routes: [
      { method: 'get', path: '/current', handlerName: 'getCurrent' },
      { method: 'post', path: '/', handlerName: 'confirm' },
      { method: 'get', path: '/:month', handlerName: 'getByMonth' },
    ],
  },
  {
    tag: 'Yearly Costs',
    basePath: '/yearly-costs',
    controller: YearlyCostController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/yearlyCostController', import.meta.url).href,
    routes: [
      { method: 'get', path: '/', handlerName: 'getYearlyCosts' },
      { method: 'post', path: '/', handlerName: 'createYearlyCost' },
      { method: 'get', path: '/suggestions', handlerName: 'getSuggestions' },
      { method: 'post', path: '/suggestions/dismiss', handlerName: 'dismissSuggestion' },
      { method: 'post', path: '/link', handlerName: 'linkTransaction' },
      { method: 'get', path: '/:id/candidates', handlerName: 'getCandidates' },
      { method: 'put', path: '/:id', handlerName: 'updateYearlyCost' },
      { method: 'delete', path: '/:id', handlerName: 'deleteYearlyCost' },
    ],
  },
  {
    tag: 'Loans',
    basePath: '/debts/loans',
    controller: LoanController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/loanController', import.meta.url).href,
    routes: [
      { method: 'get', path: '/', handlerName: 'getLoans' },
      { method: 'post', path: '/', handlerName: 'createLoan' },
      { method: 'get', path: '/:id', handlerName: 'getLoan' },
      { method: 'get', path: '/:id/match-suggestions', handlerName: 'getMatchSuggestions' },
      { method: 'get', path: '/:id/prepayment', handlerName: 'getPrepayment' },
      { method: 'post', path: '/:id/mark-past-paid', handlerName: 'markPastInstallmentsPaid' },
      { method: 'post', path: '/:id/installments/:n/match', handlerName: 'matchInstallment' },
      { method: 'post', path: '/:id/installments/:n/mark-paid', handlerName: 'markInstallmentPaid' },
      { method: 'post', path: '/:id/installments/:n/unpay', handlerName: 'unpayInstallment' },
    ],
  },
  {
    tag: 'Debts',
    basePath: '/debts',
    controller: DebtController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/debtController', import.meta.url).href,
    routes: [
      { method: 'get', path: '/', handlerName: 'getDebts' },
      { method: 'post', path: '/', handlerName: 'createDebt' },
      { method: 'put', path: '/:id', handlerName: 'updateDebt' },
      { method: 'delete', path: '/:id', handlerName: 'deleteDebt' },
      { method: 'post', path: '/:id/repayments', handlerName: 'addRepayment' },
      { method: 'get', path: '/:id/repayment-suggestions', handlerName: 'getRepaymentSuggestions' },
      { method: 'delete', path: '/:id/repayments/:paymentId', handlerName: 'deleteRepayment' },
    ],
  },
  {
    tag: 'Balance Check',
    basePath: '/accounts/balance-check',
    controller: BalanceCheckController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/balanceCheckController', import.meta.url).href,
    routes: [
      { method: 'get', path: '/', handlerName: 'getBalanceCheck' },
      { method: 'post', path: '/', handlerName: 'recordBalanceCheck' },
      { method: 'post', path: '/write-off', handlerName: 'writeOffBalanceGap' },
    ],
  },
  {
    tag: 'Accounts',
    basePath: '/accounts',
    controller: AccountController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/accountController', import.meta.url).href,
    routes: [
      { method: 'post', path: '/', handlerName: 'createAccount' },
      { method: 'get', path: '/', handlerName: 'getAllAccountsForUser' },
      { method: 'delete', path: '/', handlerName: 'deleteAccount' },
      { method: 'put', path: '/', handlerName: 'updateAccount' },
      {
        method: 'get',
        path: '/stats/balance-snapshots/',
        handlerName: 'getUserAccountsBalanceSnapshot',
      },
      {
        method: 'get',
        path: '/recalculate-balance/all',
        handlerName: 'recalculateAllUserAccountsBalances',
      },
    ],
  },
  {
    tag: 'Budgets',
    basePath: '/budgets',
    controller: BudgetController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/budgetController', import.meta.url).href,
    routes: [
      { method: 'get', path: '/', handlerName: 'getAllBudgetsForUser' },
      {
        method: 'get',
        path: '/filteredByPage/:page',
        handlerName: 'getFilteredBudgetsForUserByPage',
      },
      { method: 'post', path: '/step0', handlerName: 'addBudgetStep0' },
      { method: 'post', path: '/step1', handlerName: 'createBudget' },
      { method: 'get', path: '/matrix', handlerName: 'getBudgetMatrix' },
      {
        method: 'put',
        path: '/:id/description',
        handlerName: 'updateBudgetDescription',
      },
      { method: 'get', path: '/:id', handlerName: 'getBudget' },
      { method: 'put', path: '/', handlerName: 'updateBudget' },
      { method: 'put', path: '/status', handlerName: 'changeBudgetStatus' },
      { method: 'delete', path: '/', handlerName: 'removeBudget' },
      { method: 'get', path: '/list/summary', handlerName: 'getBudgetsListForUser' },
      { method: 'put', path: '/:id', handlerName: 'updateBudgetCategoryPlannedValues' },
    ],
  },
  {
    tag: 'Categories',
    basePath: '/cats',
    controller: CategoryController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/categoryController', import.meta.url).href,
    routes: [
      { method: 'get', path: '/', handlerName: 'getAllCategoriesForUser' },
      { method: 'post', path: '/', handlerName: 'createCategory' },
      { method: 'delete', path: '/', handlerName: 'deleteCategory' },
      { method: 'put', path: '/', handlerName: 'updateCategory' },
    ],
  },
  {
    tag: 'Entities',
    basePath: '/entities',
    controller: EntityController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/entityController', import.meta.url).href,
    routes: [
      { method: 'get', path: '/', handlerName: 'getAllEntitiesForUser' },
      { method: 'post', path: '/', handlerName: 'createEntity' },
      { method: 'delete', path: '/', handlerName: 'deleteEntity' },
      { method: 'put', path: '/', handlerName: 'updateEntity' },
    ],
  },
  {
    tag: 'Rules',
    basePath: '/rules',
    controller: RuleController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/ruleController', import.meta.url).href,
    routes: [
      { method: 'get', path: '/', handlerName: 'getAllRulesForUser' },
      { method: 'post', path: '/', handlerName: 'createRule' },
      { method: 'delete', path: '/', handlerName: 'deleteRule' },
      { method: 'put', path: '/', handlerName: 'updateRule' },
    ],
  },
  {
    tag: 'Stats',
    basePath: '/stats',
    controller: StatsController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/statsController', import.meta.url).href,
    routes: [
      {
        method: 'get',
        path: '/dashboard/month-expenses-income-distribution',
        handlerName: 'getExpensesIncomeDistributionForMonth',
      },
      {
        method: 'get',
        path: '/stats/monthly-patrimony-projections',
        handlerName: 'getMonthlyPatrimonyProjections',
      },
      { method: 'get', path: '/userStats', handlerName: 'getUserCounterStats' },
      {
        method: 'get',
        path: '/category-expenses-evolution',
        handlerName: 'getCategoryEntityTagExpensesEvolution',
      },
      {
        method: 'get',
        path: '/category-income-evolution',
        handlerName: 'getCategoryEntityTagIncomeEvolution',
      },
      {
        method: 'get',
        path: '/year-by-year-income-expense-distribution',
        handlerName: 'getYearByYearIncomeExpenseDistribution',
      },
      { method: 'get', path: '/dashboard/month-by-month', handlerName: 'getMonthByMonthData' },
    ],
  },
  {
    tag: 'Transactions',
    basePath: '/trxs',
    controller: TransactionController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/transactionController', import.meta.url).href,
    routes: [
      { method: 'get', path: '/', handlerName: 'getTransactionsForUser' },
      { method: 'get', path: '/filteredByPage/:page', handlerName: 'getFilteredTrxByPage' },
      { method: 'post', path: '/step0', handlerName: 'createTransactionStep0' },
      { method: 'post', path: '/step1', handlerName: 'createTransaction' },
      { method: 'delete', path: '/', handlerName: 'deleteTransaction' },
      { method: 'put', path: '/', handlerName: 'updateTransaction' },
      { method: 'put', path: '/bulk', handlerName: 'bulkUpdateTransactions' },
      {
        method: 'get',
        path: '/inMonthAndCategory',
        handlerName: 'getAllTransactionsForUserInCategoryAndInMonth',
      },
      { method: 'post', path: '/auto-cat-trx', handlerName: 'autoCategorizeTransaction' },
      { method: 'post', path: '/import/step0', handlerName: 'importTransactionsStep0' },
      { method: 'post', path: '/import/step1', handlerName: 'importTransactionsStep1' },
      { method: 'post', path: '/import/step2', handlerName: 'importTransactionsStep2' },
      { method: 'post', path: '/import/phonepe/preview', handlerName: 'importPhonePePreview' },
      {
        method: 'post',
        path: '/import/phonepe/categorize',
        handlerName: 'importPhonePeCategorize',
      },
    ],
  },
  {
    tag: 'Invest Assets',
    basePath: '/invest/assets',
    controller: InvestAssetsController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/investAssetsController', import.meta.url).href,
    routes: [
      { method: 'get', path: '/', handlerName: 'getAllAssetsForUser' },
      { method: 'post', path: '/', handlerName: 'createAsset' },
      { method: 'delete', path: '/:id', handlerName: 'deleteAsset' },
      { method: 'put', path: '/:id', handlerName: 'updateAsset' },
      { method: 'put', path: '/:id/value', handlerName: 'updateCurrentAssetValue' },
      {
        method: 'delete',
        path: '/:id/value/:year/:month',
        handlerName: 'deleteAssetValueSnapshot',
      },
      { method: 'get', path: '/summary', handlerName: 'getAllAssetsSummaryForUser' },
      { method: 'get', path: '/stats', handlerName: 'getAssetStatsForUser' },
    ],
  },
  {
    tag: 'Invest Transactions',
    basePath: '/invest/trx',
    controller: InvestTransactionsController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/investTransactionsController', import.meta.url)
      .href,
    routes: [
      { method: 'get', path: '/', handlerName: 'getAllTransactionsForUser' },
      { method: 'get', path: '/filteredByPage/:page', handlerName: 'getFilteredTrxByPage' },
      { method: 'post', path: '/', handlerName: 'createTransaction' },
      { method: 'delete', path: '/:id', handlerName: 'deleteTransaction' },
      { method: 'put', path: '/:id', handlerName: 'updateTransaction' },
    ],
  },
  {
    tag: 'Invest Reports',
    basePath: '/invest/reports',
    controller: InvestReportsController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/investReportsController', import.meta.url)
      .href,
    routes: [{ method: 'get', path: '/annual/:year', handlerName: 'getAnnualReport' }],
  },
  {
    tag: 'Tags',
    basePath: '/tags',
    controller: TagController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/tagController', import.meta.url).href,
    routes: [
      { method: 'get', path: '/filteredByPage/:page', handlerName: 'getAllTagsForUser' },
      { method: 'post', path: '/', handlerName: 'createTag' },
      { method: 'delete', path: '/:id', handlerName: 'deleteTag' },
      { method: 'put', path: '/:id', handlerName: 'updateTag' },
    ],
  },
  {
    tag: 'Goals',
    basePath: '/goals',
    controller: GoalController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/goalController', import.meta.url).href,
    routes: [
      { method: 'get', path: '/', handlerName: 'getAllGoalsForUser' },
      { method: 'post', path: '/', handlerName: 'createGoal' },
      { method: 'put', path: '/:id', handlerName: 'updateGoal' },
      { method: 'delete', path: '/:id', handlerName: 'deleteGoal' },
    ],
  },
  {
    tag: 'Setup',
    basePath: '/setup',
    controller: SetupController as ControllerModule,
    controllerSourceBaseUrl: new URL('../controllers/setupController', import.meta.url).href,
    routes: [{ method: 'post', path: '/init', handlerName: 'initInstance' }],
  },
];

export const registerRoutes = (app: Express) => {
  for (const group of routeGroups) {
    const router = express.Router();

    for (const route of group.routes) {
      const handler = group.controller[route.handlerName];

      if (typeof handler !== 'function') {
        throw new Error(
          `Route handler "${route.handlerName}" was not found for controller tag "${group.tag}".`
        );
      }

      router[route.method](route.path, handler);
    }

    app.use(group.basePath, router);
  }
};
