import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { MYFIN } from "../../consts.js";
import APIError from "../../errorHandling/apiError.js";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const TIMEZONE = "Asia/Kolkata";
const UPI_LITE_KEY = "UPI Lite";
const HEADER_PREFIX = "Date,Time,Transaction Details";
const MAX_KEY_LENGTH = 64; // transactions.external_id and import_instrument_mappings.instrument_key are VARCHAR(64)
const DATE_TIME_FORMATS = [
  "MMM DD, YYYY hh:mm a",
  "MMM D, YYYY h:mm a",
  "MMM DD, YYYY h:mm a",
  "MMM D, YYYY hh:mm a",
];
/** A line that starts like a PhonePe data row: optional quote, month abbreviation, day, comma, year. */
const DATA_ROW_LIKE = /^"?[A-Z][a-z]{2,3} \d{1,2}, \d{4}/;

export type PhonePeRow = {
  externalId: string; // `phonepe:${txnId}:${direction}`
  date: number; // unix seconds, Asia/Kolkata
  description: string; // cleaned
  amount: number; // decimal rupees, positive
  direction: "DEBIT" | "CREDIT";
  instrumentKey: string; // e.g. 'XXXXXXXXXXX3300', 'UPI Lite'
};

export type ClassifiedPhonePeRow = PhonePeRow & {
  type: "I" | "E" | "T";
  fromKey: string | null;
  toKey: string | null;
};

/** Splits a CSV line into fields; fields may be double-quoted and contain commas. */
const splitCsvLine = (line: string): string[] => {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
};

/** Returns null when the line is not an 8-field row; throws when it is one but is malformed. */
const parseDataRow = (line: string, lineNo: number): PhonePeRow | null => {
  const f = splitCsvLine(line);
  if (f.length !== 8) return null;
  const invalid = (what: string) =>
    APIError.badRequest(`Invalid PhonePe statement: ${what} on line ${lineNo}`);
  const [dateStr, timeStr, details, txnId, , type, instrument, amountStr] = f.map((s) => s.trim());

  // Parse in UTC first (non-throwing, strict), then re-interpret the wall-clock time as IST.
  // Strict parsing only matches lowercase am/pm, so normalise the meridiem first.
  // Formats are tried one by one: dayjs.utc() with a format array silently drops UTC mode.
  const input = `${dateStr.replace(/^Sept\b/, "Sep")} ${timeStr.replace(/\b(am|pm)$/i, (m) => m.toLowerCase())}`;
  const wall = DATE_TIME_FORMATS.map((fmt) => dayjs.utc(input, fmt, true)).find((d) => d.isValid());
  if (!wall) throw invalid("unparseable date/time");
  const parsed = dayjs.tz(wall.format("YYYY-MM-DD HH:mm"), TIMEZONE);

  const direction = type.toUpperCase();
  if (direction !== "DEBIT" && direction !== "CREDIT") throw invalid("unknown transaction type");
  const amount = Number(amountStr);
  if (amountStr === "" || !Number.isFinite(amount) || amount <= 0) throw invalid("invalid amount");
  if (!txnId) throw invalid("missing transaction id");
  const externalId = `phonepe:${txnId}:${direction}`;
  if (externalId.length > MAX_KEY_LENGTH) throw invalid("transaction id too long");
  const instrumentKey = instrument.replace(/^(Paid by|Credited to)(\s+|$)/i, "").trim();
  if (!instrumentKey) throw invalid("missing credit/debit instrument");
  if (instrumentKey.length > MAX_KEY_LENGTH) throw invalid("credit/debit instrument too long");

  return {
    externalId,
    date: parsed.unix(),
    description: details.replace(/\s+/g, " ").trim(),
    amount,
    direction,
    instrumentKey,
  };
};

export function parsePhonePeCsv(text: string): PhonePeRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.trim().startsWith(HEADER_PREFIX));
  if (headerIdx < 0) {
    throw APIError.badRequest("Invalid PhonePe statement: header row not found");
  }

  const rows: PhonePeRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const row = parseDataRow(line, i + 1);
    if (!row) {
      // End of the data section (footer / disclaimer). A later line that still looks like a
      // data row means a malformed row cut the data short: fail instead of dropping rows.
      for (let j = i; j < lines.length; j++) {
        if (DATA_ROW_LIKE.test(lines[j].trim())) {
          throw APIError.badRequest(`Invalid PhonePe statement: malformed row on line ${j + 1}`);
        }
      }
      break;
    }
    rows.push(row);
  }
  return rows;
}

export function classifyPhonePeRow(row: PhonePeRow): ClassifiedPhonePeRow {
  if (row.direction === "DEBIT") {
    if (/^Add money UPI Lite\b/i.test(row.description)) {
      return { ...row, type: MYFIN.TRX_TYPES.TRANSFER as ClassifiedPhonePeRow["type"], fromKey: row.instrumentKey, toKey: UPI_LITE_KEY };
    }
    const card = row.description.match(/^Credit card bill paid\s+(\S+)/i);
    if (card) {
      return { ...row, type: MYFIN.TRX_TYPES.TRANSFER as ClassifiedPhonePeRow["type"], fromKey: row.instrumentKey, toKey: card[1] };
    }
    return { ...row, type: MYFIN.TRX_TYPES.EXPENSE as ClassifiedPhonePeRow["type"], fromKey: row.instrumentKey, toKey: null };
  }
  return { ...row, type: MYFIN.TRX_TYPES.INCOME as ClassifiedPhonePeRow["type"], fromKey: null, toKey: row.instrumentKey };
}

export function instrumentKeysOf(rows: ClassifiedPhonePeRow[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.fromKey) seen.add(r.fromKey);
    if (r.toKey) seen.add(r.toKey);
  }
  return [...seen];
}
