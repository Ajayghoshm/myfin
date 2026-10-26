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

const parseDataRow = (line: string): PhonePeRow | null => {
  const f = splitCsvLine(line);
  if (f.length !== 8) return null;
  const [dateStr, timeStr, details, txnId, , type, instrument, amountStr] = f.map((s) => s.trim());

  const parsed = dayjs.tz(`${dateStr.replace(/^Sept\b/, "Sep")} ${timeStr}`, "MMM DD, YYYY hh:mm a", TIMEZONE);
  if (!parsed.isValid()) return null;

  const direction = type.toUpperCase();
  if (direction !== "DEBIT" && direction !== "CREDIT") return null;
  const amount = Number(amountStr);
  if (!txnId || !Number.isFinite(amount)) return null;

  return {
    externalId: `phonepe:${txnId}:${direction}`,
    date: parsed.unix(),
    description: details.replace(/\s+/g, " ").trim(),
    amount,
    direction,
    instrumentKey: instrument.replace(/^(Paid by|Credited to)\s+/i, "").trim(),
  };
};

export function parsePhonePeCsv(text: string): PhonePeRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.trim().startsWith(HEADER_PREFIX));
  if (headerIdx < 0) {
    throw APIError.badRequest("Invalid PhonePe statement: header row not found");
  }

  const rows: PhonePeRow[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    if (line.trim() === "") continue;
    const row = parseDataRow(line);
    if (!row) break; // footer / disclaimer
    rows.push(row);
  }
  return rows;
}

export function classifyPhonePeRow(row: PhonePeRow): ClassifiedPhonePeRow {
  if (row.direction === "DEBIT") {
    if (/^Add money UPI Lite\b/i.test(row.description)) {
      return { ...row, type: MYFIN.TRX_TYPES.TRANSFER, fromKey: row.instrumentKey, toKey: UPI_LITE_KEY };
    }
    const card = row.description.match(/^Credit card bill paid\s+(\S+)/i);
    if (card) {
      return { ...row, type: MYFIN.TRX_TYPES.TRANSFER, fromKey: row.instrumentKey, toKey: card[1] };
    }
    return { ...row, type: MYFIN.TRX_TYPES.EXPENSE, fromKey: row.instrumentKey, toKey: null };
  }
  return { ...row, type: MYFIN.TRX_TYPES.INCOME, fromKey: null, toKey: row.instrumentKey };
}

export function instrumentKeysOf(rows: ClassifiedPhonePeRow[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.fromKey) seen.add(r.fromKey);
    if (r.toKey) seen.add(r.toKey);
  }
  return [...seen];
}
