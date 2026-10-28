import { performDatabaseRequest } from '../config/prisma.js';
import { demoCalendar } from './demoData/dataset.js';
import { createFeatures } from './demoData/features.js';
import { createLedger } from './demoData/ledger.js';

/**
 * Replaces the user's data with the Indian demo dataset. The ledger (wipe included) is one
 * transaction; the loan, debts, planning, routines and legacy parts then go through their services,
 * which commit on their own.
 */
const createMockData = async (userId: bigint, dbClient = undefined) => {
  const cal = demoCalendar();
  const ledger = await performDatabaseRequest(
    (prismaTx) => createLedger(userId, cal, prismaTx),
    dbClient,
    {
      timeout: 120_000,
      maxWait: 10_000,
    }
  );
  await createFeatures(userId, cal, ledger);
};

export default {
  createMockData,
};
