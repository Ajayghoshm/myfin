/** Asia/Kolkata is a fixed UTC+05:30 offset (no DST). */
const IST_OFFSET_SECONDS = 19800;

const YM_REGEX = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isYearMonth(ym: string | null | undefined): ym is string {
  return ym != null && YM_REGEX.test(ym);
}

export function parseYearMonth(ym: string): { year: number; month: number } {
  const match = YM_REGEX.exec(ym);
  if (!match) throw new Error(`Invalid year-month: ${ym}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function formatYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** IST month as an epoch-second range [from, to). `ym` is 'YYYY-MM'. */
export function istMonthRange(ym: string): { from: number; to: number } {
  const { year, month } = parseYearMonth(ym);
  const from = Date.UTC(year, month - 1, 1) / 1000 - IST_OFFSET_SECONDS;
  const to = Date.UTC(year, month, 1) / 1000 - IST_OFFSET_SECONDS;
  return { from, to };
}

/** The current month in IST, as 'YYYY-MM'. */
export function currentYearMonth(): string {
  const ist = new Date(Date.now() + IST_OFFSET_SECONDS * 1000);
  return formatYearMonth(ist.getUTCFullYear(), ist.getUTCMonth() + 1);
}

/** The IST calendar month of an epoch-second timestamp, as 'YYYY-MM'. */
export function istYearMonthOf(timestamp: number): string {
  const ist = new Date((timestamp + IST_OFFSET_SECONDS) * 1000);
  return formatYearMonth(ist.getUTCFullYear(), ist.getUTCMonth() + 1);
}
