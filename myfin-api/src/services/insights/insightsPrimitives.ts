import { Prisma } from '../../generated/prisma/client.js';

export type YearMonth = { year: number; month: number }; // month 1-12

export const IST_OFFSET_SECONDS = 19800; // UTC+05:30, no DST

/** Epoch-second range [from, to) for a calendar month in Asia/Kolkata. */
export function monthRangeIST(ym: YearMonth): { from: number; to: number } {
  const from = Date.UTC(ym.year, ym.month - 1, 1) / 1000 - IST_OFFSET_SECONDS;
  const to = Date.UTC(ym.year, ym.month, 1) / 1000 - IST_OFFSET_SECONDS;
  return { from, to };
}

export function shiftMonth(ym: YearMonth, delta: number): YearMonth {
  const idx = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (((idx % 12) + 12) % 12) + 1 };
}

/** Normalised payee key over transactions.description (SQL only). */
export const payeeKeySql: Prisma.Sql = Prisma.sql`REGEXP_REPLACE(UPPER(TRIM(REGEXP_REPLACE(COALESCE(transactions.description,''), '[[:space:]]+', ' '))), '^(PAID TO|RECEIVED FROM|REQUESTED BY|PAYMENT TO) ', '')`;

/** Boolean SQL: description starts with 'Requested by ' or 'Received from ' (case-insensitive). */
export const PERSON_PREFIX_SQL: Prisma.Sql = Prisma.sql`(UPPER(COALESCE(transactions.description,'')) LIKE 'REQUESTED BY %' OR UPPER(COALESCE(transactions.description,'')) LIKE 'RECEIVED FROM %')`;

export const BUSINESS_WORDS: readonly string[] = [
  'PVT', 'LTD', 'LIMITED', 'PRIVATE', 'LLP', 'INC', 'CORP', 'CO', 'COMPANY',
  'SERVICES', 'SERVICE', 'HOSPITALITY', 'HOTEL', 'HOTELS', 'RESTAURANT', 'CAFE',
  'BAKERY', 'FOODS', 'FOOD', 'STORE', 'STORES', 'SUPERMARKET', 'MART', 'MEDICALS',
  'PHARMACY', 'HOSPITAL', 'CLINIC', 'TRADERS', 'ENTERPRISES', 'ENTERPRISE',
  'TECHNOLOGIES', 'TECHNOLOGY', 'SOLUTIONS', 'SYSTEMS', 'BANK', 'INSURANCE',
  'RECHARGE', 'PAYMENTS', 'TRAVELS', 'MOTORS', 'FUEL', 'PETROLEUM',
  'SWIGGY', 'ZOMATO', 'NETFLIX', 'AMAZON', 'FLIPKART', 'UBER', 'OLA', 'BLINKIT',
  'ZEPTO', 'BIGBASKET', 'MYNTRA', 'SPOTIFY', 'AIRTEL', 'JIO', 'GOOGLE', 'APPLE',
  'IRCTC', 'PHONEPE', 'PAYTM', 'DMART', 'RELIANCE',
];

const BUSINESS_SET = new Set(BUSINESS_WORDS);

export function guessIsPerson(
  payeeKey: string,
  signals: { hasPersonPrefix: boolean; hasRoundPaymentOver1000: boolean },
): boolean {
  if (!payeeKey) return false;
  if (payeeKey.toUpperCase().split(/[^A-Z0-9]+/).some((w) => BUSINESS_SET.has(w))) return false;
  return signals.hasPersonPrefix || signals.hasRoundPaymentOver1000;
}
