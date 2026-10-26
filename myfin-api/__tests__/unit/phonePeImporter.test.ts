import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { describe, expect, test } from "vitest";
import {
  classifyPhonePeRow,
  instrumentKeysOf,
  parsePhonePeCsv,
  type PhonePeRow,
} from "../../src/services/importers/phonePeImporter.js";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "fixtures", "phonepe-statement.csv"), "utf8");
const HEADER = "Date,Time,Transaction Details,Transaction ID,UTR,Transaction Type,Credit/debit instrument,Amount\n";
const IST = "Asia/Kolkata";

const csvRow = (date: string, time: string, details: string, id: string, type: string, instr: string, amount: string) =>
  `"${date}","${time}","${details}","${id}","1","${type}","${instr}","${amount}"\n`;

const base: PhonePeRow = {
  externalId: "phonepe:X:DEBIT",
  date: 0,
  description: "Paid to X",
  amount: 1,
  direction: "DEBIT",
  instrumentKey: "XXXXXXXXXXX3300",
};

describe("parsePhonePeCsv", () => {
  const rows = parsePhonePeCsv(fixture);
  const byId = (id: string) => rows.find((r) => r.externalId.includes(id))!;

  test("returns one entry per data row, ignoring header lines and footer", () => {
    expect(rows).toHaveLength(18);
  });

  test("parses a regular row", () => {
    const r = byId("T2610261346425001911421");
    expect(r.externalId).toBe("phonepe:T2610261346425001911421:DEBIT");
    expect(r.amount).toBe(121);
    expect(r.instrumentKey).toBe("XXXXXXXXXXX3300");
    expect(r.description).toBe("Paid to SWIGGY");
    expect(r.direction).toBe("DEBIT");
    expect(r.date).toBe(dayjs.tz("2026-10-26 13:46", IST).unix());
  });

  test("parses Sept dates", () => {
    expect(byId("T2609302133580825142206").date).toBe(dayjs.tz("2026-09-30 21:33", IST).unix());
  });

  test("parses 12:48 am as hour 0", () => {
    expect(byId("T2610210048049194422347").date).toBe(dayjs.tz("2026-10-21 00:48", IST).unix());
  });

  test("keeps decimal amounts exact", () => {
    expect(byId("D2610261258325418587280").amount).toBe(4837.55);
  });

  test("cleans whitespace and keeps emoji", () => {
    expect(byId("T2610210048049194422347").description).toBe("Paid to PERSON B");
    expect(byId("T2610220911392492059530").description).toBe("Paid to VEG BASKET");
    expect(byId("T2610051521432239038260").description).toBe("Paid to PERSON C 🌛");
  });

  test("extracts instrument keys", () => {
    expect(byId("T2610261123367537860380").instrumentKey).toBe("UPI Lite");
    expect(byId("T2610141442574594348185").instrumentKey).toBe("XXXXXXXXXXX3300");
    expect(byId("T2610141442574594348185").direction).toBe("CREDIT");
  });

  test("handles a leading BOM", () => {
    expect(parsePhonePeCsv("﻿" + fixture)).toHaveLength(18);
  });

  test("throws a 400 when the header row is missing", () => {
    expect(() => parsePhonePeCsv("foo,bar\n1,2")).toThrowError(expect.objectContaining({ code: 400 }));
  });

  test("handles CRLF line endings", () => {
    expect(parsePhonePeCsv(fixture.replace(/\n/g, "\r\n"))).toHaveLength(18);
  });

  test("handles a large file (> 300 KB)", () => {
    let csv = HEADER;
    for (let i = 0; i < 3500; i++) {
      csv += csvRow("Oct 26, 2026", "01:46 pm", "Paid to SWIGGY", `T${i}`, "DEBIT", "Paid by XXXXXXXXXXX3300", "121");
    }
    expect(csv.length).toBeGreaterThan(300 * 1024);
    expect(parsePhonePeCsv(csv)).toHaveLength(3500);
  });
});

describe("classifyPhonePeRow", () => {
  test("Add money UPI Lite is a transfer to UPI Lite", () => {
    const c = classifyPhonePeRow({ ...base, description: "Add money UPI Lite" });
    expect(c).toMatchObject({ type: "T", fromKey: "XXXXXXXXXXX3300", toKey: "UPI Lite" });
  });

  test("Credit card bill paid is a transfer to the card", () => {
    const c = classifyPhonePeRow({ ...base, description: "Credit card bill paid XXXXXXXXXXXX2001" });
    expect(c).toMatchObject({ type: "T", fromKey: "XXXXXXXXXXX3300", toKey: "XXXXXXXXXXXX2001" });
  });

  test("CREDIT is income", () => {
    const c = classifyPhonePeRow({ ...base, direction: "CREDIT", description: "Received from X" });
    expect(c).toMatchObject({ type: "I", fromKey: null, toKey: "XXXXXXXXXXX3300" });
  });

  test("Requested by DEBIT is an expense", () => {
    const c = classifyPhonePeRow({ ...base, description: "Requested by Utthara M" });
    expect(c).toMatchObject({ type: "E", fromKey: "XXXXXXXXXXX3300", toKey: null });
  });
});

describe("instrumentKeysOf", () => {
  test("returns distinct keys including transfer targets, first-seen order", () => {
    const rows = [
      classifyPhonePeRow({ ...base, description: "Add money UPI Lite" }),
      classifyPhonePeRow({ ...base, description: "Credit card bill paid XXXXXXXXXXXX2001" }),
      classifyPhonePeRow({ ...base, instrumentKey: "UPI Lite" }),
      classifyPhonePeRow({ ...base, direction: "CREDIT", instrumentKey: "XXXXXX6759" }),
    ];
    expect(instrumentKeysOf(rows)).toEqual(["XXXXXXXXXXX3300", "UPI Lite", "XXXXXXXXXXXX2001", "XXXXXX6759"]);
  });
});
