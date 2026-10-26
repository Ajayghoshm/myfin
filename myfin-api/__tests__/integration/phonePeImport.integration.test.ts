import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test } from "vitest";
import UserService from "../../src/services/userService.js";
import AccountService from "../../src/services/accountService.js";
import { MYFIN } from "../../src/consts.js";
import { prisma } from "../../src/config/prisma.js";
import PhonePeImportService from "../../src/services/phonePeImportService.js";
import TransactionService, { CreateTransactionType } from "../../src/services/transactionService.js";
import { expectThrowErrorCode } from "./utils/testUtils.js";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../unit/fixtures/phonepe-statement.csv"),
  "utf8"
);

const BANK_KEY = "XXXXXXXXXXX3300";
const LITE_KEY = "UPI Lite";
const CARD_KEY = "XXXXXXXXXXXX2001";
const OTHER_KEYS = ["XXXXXX6759", "653001XXXXXXXX73", "356146XXXXXXXX05"];
const FIXTURE_ROWS = 18;

const SWIGGY_ID = "phonepe:T2610261346425001911421:DEBIT";
const LITE_TOPUP_ID = "phonepe:W2610081303177861357192:DEBIT";
const CARD_BILL_ID = "phonepe:NB26101217153886129140372:DEBIT";
const CREDIT_ID = "phonepe:T2610141442574594348185:CREDIT";

const createAccount = (userId: bigint, name: string) =>
  AccountService.createAccount(
    {
      name,
      type: MYFIN.ACCOUNT_TYPES.CHECKING,
      description: "",
      status: MYFIN.ACCOUNT_STATUS.ACTIVE,
      exclude_from_budgets: false,
      current_balance: 0,
      users_user_id: userId,
    },
    userId
  );

describe("PhonePe import (preview / categorize)", () => {
  let user: { user_id: bigint };
  let bank3300: { account_id: bigint };
  let upiLite: { account_id: bigint };
  let card2001: { account_id: bigint };
  let other: { account_id: bigint };
  let allMappings: Array<{ key: string; account_id: bigint }>;

  beforeEach(async () => {
    user = await UserService.createUser({ username: "demo", password: "123", email: "demo@afaneca.com" });
    bank3300 = await createAccount(user.user_id, "bank3300");
    upiLite = await createAccount(user.user_id, "upiLite");
    card2001 = await createAccount(user.user_id, "card2001");
    other = await createAccount(user.user_id, "other");
    allMappings = [
      { key: BANK_KEY, account_id: bank3300.account_id },
      { key: LITE_KEY, account_id: upiLite.account_id },
      { key: CARD_KEY, account_id: card2001.account_id },
      ...OTHER_KEYS.map((key) => ({ key, account_id: other.account_id })),
    ];
  });

  test("preview of a fresh statement: no duplicates, all instruments unmapped", async () => {
    const preview = await PhonePeImportService.previewPhonePeImport(user.user_id, fixture);
    expect(preview.total_rows).toBe(FIXTURE_ROWS);
    expect(preview.duplicate_rows).toBe(0);
    expect(preview.new_rows).toBe(FIXTURE_ROWS);
    expect(preview.instruments.map((i) => i.key).sort()).toEqual(
      [BANK_KEY, LITE_KEY, CARD_KEY, ...OTHER_KEYS].sort()
    );
    for (const instrument of preview.instruments) {
      expect(instrument.account_id).toBeNull();
      expect(typeof instrument.sample_description).toBe("string");
      expect(instrument.sample_description.length).toBeGreaterThan(0);
    }
  });

  test("categorize with all keys mapped classifies transfers, expenses and income", async () => {
    const result = await PhonePeImportService.categorizePhonePeImport(user.user_id, fixture, allMappings);
    expect(result.fillData).toHaveLength(FIXTURE_ROWS);
    expect(result.duplicate_rows).toBe(0);
    for (const item of result.fillData) expect(item.external_id).toMatch(/^phonepe:/);

    const byId = (id: string) => result.fillData.find((r) => r.external_id === id);

    const topUp = byId(LITE_TOPUP_ID);
    expect(topUp.type).toBe(MYFIN.TRX_TYPES.TRANSFER);
    expect(topUp.selectedAccountFromID).toBe(bank3300.account_id);
    expect(topUp.selectedAccountToID).toBe(upiLite.account_id);

    const cardBill = byId(CARD_BILL_ID);
    expect(cardBill.type).toBe(MYFIN.TRX_TYPES.TRANSFER);
    expect(cardBill.selectedAccountToID).toBe(card2001.account_id);

    const swiggy = byId(SWIGGY_ID);
    expect(swiggy.type).toBe(MYFIN.TRX_TYPES.EXPENSE);
    expect(swiggy.selectedAccountFromID).toBe(bank3300.account_id);
    expect(swiggy.amount).toBe(121);

    const credit = byId(CREDIT_ID);
    expect(credit.type).toBe(MYFIN.TRX_TYPES.INCOME);
    expect(credit.selectedAccountToID).toBe(bank3300.account_id);

    // Same shape as importTransactionsStep1
    expect(result.accounts).toHaveLength(4);
    expect(result.accounts[0]).toEqual(
      expect.objectContaining({ account_id: expect.anything(), name: expect.any(String), balance: 0 })
    );
    expect(Array.isArray(result.categories)).toBe(true);
    expect(Array.isArray(result.entities)).toBe(true);
  });

  test("mappings saved by categorize are shown by the next preview; deleting an account unmaps its key", async () => {
    await PhonePeImportService.categorizePhonePeImport(user.user_id, fixture, allMappings);

    let preview = await PhonePeImportService.previewPhonePeImport(user.user_id, fixture);
    const accountOf = (key: string) => preview.instruments.find((i) => i.key === key).account_id;
    for (const m of allMappings) expect(accountOf(m.key)).toBe(m.account_id);

    await AccountService.deleteAccount(card2001.account_id);
    preview = await PhonePeImportService.previewPhonePeImport(user.user_id, fixture);
    expect(accountOf(CARD_KEY)).toBeNull();
    expect(accountOf(BANK_KEY)).toBe(bank3300.account_id);
  });

  test("re-categorizing updates an existing mapping instead of duplicating it", async () => {
    await PhonePeImportService.categorizePhonePeImport(user.user_id, fixture, allMappings);
    const remapped = allMappings.map((m) => (m.key === LITE_KEY ? { ...m, account_id: other.account_id } : m));
    await PhonePeImportService.categorizePhonePeImport(user.user_id, fixture, remapped);

    const rows = await prisma.import_instrument_mappings.findMany({
      where: { users_user_id: user.user_id, instrument_key: LITE_KEY },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].accounts_account_id).toBe(other.account_id);
    expect(rows[0].source).toBe("phonepe");
  });

  test("categorize rejects an account belonging to another user", async () => {
    const user2 = await UserService.createUser({ username: "demo2", password: "123", email: "demo2@afaneca.com" });
    const foreign = await createAccount(user2.user_id, "foreign");
    const mappings = allMappings.map((m) => (m.key === BANK_KEY ? { ...m, account_id: foreign.account_id } : m));
    await expectThrowErrorCode(
      () => PhonePeImportService.categorizePhonePeImport(user.user_id, fixture, mappings),
      401
    );
    expect(await prisma.import_instrument_mappings.count()).toBe(0);
  });

  test("categorize rejects when a key used by a new row is unmapped", async () => {
    const mappings = allMappings.filter((m) => m.key !== LITE_KEY);
    await expectThrowErrorCode(
      () => PhonePeImportService.categorizePhonePeImport(user.user_id, fixture, mappings),
      400
    );
  });

  test("rows already imported (by external_id) are duplicates and dropped", async () => {
    await prisma.transactions.create({
      data: {
        date_timestamp: 1,
        amount: 12100,
        type: MYFIN.TRX_TYPES.EXPENSE,
        description: "Paid to SWIGGY",
        accounts_account_from_id: bank3300.account_id,
        external_id: SWIGGY_ID,
      },
    });

    const preview = await PhonePeImportService.previewPhonePeImport(user.user_id, fixture);
    expect(preview.duplicate_rows).toBe(1);
    expect(preview.new_rows).toBe(FIXTURE_ROWS - 1);

    const result = await PhonePeImportService.categorizePhonePeImport(user.user_id, fixture, allMappings);
    expect(result.duplicate_rows).toBe(1);
    expect(result.fillData).toHaveLength(FIXTURE_ROWS - 1);
    expect(result.fillData.find((r) => r.external_id === SWIGGY_ID)).toBeUndefined();
  });

  test("another user's transaction with the same external_id is not a duplicate", async () => {
    const user2 = await UserService.createUser({ username: "demo2", password: "123", email: "demo2@afaneca.com" });
    const foreign = await createAccount(user2.user_id, "foreign");
    await prisma.transactions.create({
      data: {
        date_timestamp: 1,
        amount: 12100,
        type: MYFIN.TRX_TYPES.EXPENSE,
        description: "Paid to SWIGGY",
        accounts_account_from_id: foreign.account_id,
        external_id: SWIGGY_ID,
      },
    });

    const existing = await PhonePeImportService.getExistingExternalIds(user.user_id, [SWIGGY_ID, CREDIT_ID]);
    expect(existing.size).toBe(0);
    const existingForUser2 = await PhonePeImportService.getExistingExternalIds(user2.user_id, [SWIGGY_ID]);
    expect([...existingForUser2]).toEqual([SWIGGY_ID]);
  });

  test("a row repeated within the same file is a duplicate; only the first is kept", async () => {
    const swiggyLine = fixture.split(/\r?\n/).find((l) => l.includes("T2610261346425001911421"));
    const lines = fixture.split(/\r?\n/);
    const headerIdx = lines.findIndex((l) => l.startsWith("Date,Time,"));
    lines.splice(headerIdx + 2, 0, swiggyLine);
    const csv = lines.join("\n");

    const preview = await PhonePeImportService.previewPhonePeImport(user.user_id, csv);
    expect(preview.total_rows).toBe(FIXTURE_ROWS + 1);
    expect(preview.duplicate_rows).toBe(1);
    expect(preview.new_rows).toBe(FIXTURE_ROWS);

    const result = await PhonePeImportService.categorizePhonePeImport(user.user_id, csv, allMappings);
    expect(result.duplicate_rows).toBe(1);
    expect(result.fillData.filter((r) => r.external_id === SWIGGY_ID)).toHaveLength(1);
  });

  test("mappings for keys not used by the file's new rows are not saved", async () => {
    const extra = { key: "XXXXUNUSED9999", account_id: other.account_id };
    await PhonePeImportService.categorizePhonePeImport(user.user_id, fixture, [...allMappings, extra]);
    const saved = await prisma.import_instrument_mappings.findMany({ where: { users_user_id: user.user_id } });
    expect(saved.map((m) => m.instrument_key).sort()).toEqual(allMappings.map((m) => m.key).sort());
  });

  test("categorize handles a large statement (300 new rows)", async () => {
    const header =
      "Date,Time,Transaction Details,Transaction ID,UTR,Transaction Type,Credit/debit instrument,Amount";
    const rows = Array.from(
      { length: 300 },
      (_, i) =>
        `"Oct 26, 2026","01:46 pm","Paid to MERCHANT ${i}","TSYN${String(i).padStart(6, "0")}","${i}","DEBIT","Paid by ${BANK_KEY}","${i + 1}"`
    );
    const csv = [header, ...rows].join("\n");
    const result = await PhonePeImportService.categorizePhonePeImport(user.user_id, csv, [
      { key: BANK_KEY, account_id: bank3300.account_id },
    ]);
    expect(result.fillData).toHaveLength(300);
    expect(new Set(result.fillData.map((r) => r.external_id)).size).toBe(300);
    expect(result.fillData[299].amount).toBe(300);
    for (const item of result.fillData) expect(item.selectedAccountFromID).toBe(bank3300.account_id);
  }, 60_000);

  test("an instrument used only by duplicate rows is not listed and need not be mapped", async () => {
    // Make every row paid by 356146XXXXXXXX05 (only the INDIGO row) a duplicate
    await prisma.transactions.create({
      data: {
        date_timestamp: 1,
        amount: 1167000,
        type: MYFIN.TRX_TYPES.EXPENSE,
        description: "Paid to INDIGO AIRLINE",
        accounts_account_from_id: other.account_id,
        external_id: "phonepe:T2610122237588295373882:DEBIT",
      },
    });
    const preview = await PhonePeImportService.previewPhonePeImport(user.user_id, fixture);
    expect(preview.instruments.map((i) => i.key)).not.toContain("356146XXXXXXXX05");

    const mappings = allMappings.filter((m) => m.key !== "356146XXXXXXXX05");
    const result = await PhonePeImportService.categorizePhonePeImport(user.user_id, fixture, mappings);
    expect(result.fillData).toHaveLength(FIXTURE_ROWS - 1);
  });

  describe("saving (createTransactionsInBulk)", () => {
    const toCreateList = async (csv = fixture): Promise<Array<CreateTransactionType>> => {
      const result = await PhonePeImportService.categorizePhonePeImport(user.user_id, csv, allMappings);
      return result.fillData.map((r) => ({
        amount: r.amount,
        type: r.type,
        description: r.description,
        entity_id: r.selectedEntityID,
        account_from_id: r.selectedAccountFromID,
        account_to_id: r.selectedAccountToID,
        category_id: r.selectedCategoryID,
        date_timestamp: r.date,
        is_essential: r.isEssential ?? false,
        external_id: r.external_id,
      }));
    };
    const balanceOf = async (id: bigint) =>
      Number((await prisma.accounts.findUniqueOrThrow({ where: { account_id: id } })).current_balance);

    test("imports all rows with external_id, moves balances, and a second run skips everything", async () => {
      const list = await toCreateList();
      const res = await TransactionService.createTransactionsInBulk(user.user_id, list.map((t) => ({ ...t })));
      expect(res).toEqual({ imported: FIXTURE_ROWS, skipped: 0 });
      expect(await prisma.transactions.count({ where: { external_id: { startsWith: "phonepe:" } } })).toBe(
        FIXTURE_ROWS
      );

      const again = await TransactionService.createTransactionsInBulk(user.user_id, list.map((t) => ({ ...t })));
      expect(again).toEqual({ imported: 0, skipped: FIXTURE_ROWS });
      expect(await prisma.transactions.count()).toBe(FIXTURE_ROWS);
    });

    test("top-up transfer moves 4998 from bank3300 to upiLite", async () => {
      const list = await toCreateList();
      const topUp = list.filter((t) => t.external_id === LITE_TOPUP_ID);
      const before = await balanceOf(bank3300.account_id);
      await TransactionService.createTransactionsInBulk(user.user_id, topUp);
      expect(await balanceOf(bank3300.account_id)).toBe(before - 4998 * 100);
      expect(await balanceOf(upiLite.account_id)).toBe(4998 * 100);
    });

    test("preview after import reports no new rows; a file with 2 extra rows reports 2", async () => {
      const list = await toCreateList();
      await TransactionService.createTransactionsInBulk(user.user_id, list);
      let preview = await PhonePeImportService.previewPhonePeImport(user.user_id, fixture);
      expect(preview.new_rows).toBe(0);
      expect(preview.duplicate_rows).toBe(FIXTURE_ROWS);

      const extra = [1, 2].map(
        (i) =>
          `"Oct 27, 2026","01:46 pm","Paid to NEWMERCHANT ${i}","TNEW00000${i}","${i}","DEBIT","Paid by ${BANK_KEY}","${i * 10}"`
      );
      const lines = fixture.split(/\r?\n/);
      lines.splice(lines.findIndex((l) => l.startsWith("Date,Time,")) + 1, 0, ...extra);
      preview = await PhonePeImportService.previewPhonePeImport(user.user_id, lines.join("\n"));
      expect(preview.new_rows).toBe(2);
    });

    test("duplicates within the submitted list are skipped; items without external_id always import", async () => {
      const list = await toCreateList();
      const swiggy = list.find((t) => t.external_id === SWIGGY_ID);
      const res = await TransactionService.createTransactionsInBulk(user.user_id, [{ ...swiggy }, { ...swiggy }]);
      expect(res).toEqual({ imported: 1, skipped: 1 });

      const paste = () => {
        const { external_id, ...rest } = swiggy;
        return { ...rest };
      };
      const pasted = await TransactionService.createTransactionsInBulk(user.user_id, [paste(), paste()]);
      expect(pasted).toEqual({ imported: 2, skipped: 0 });
      const again = await TransactionService.createTransactionsInBulk(user.user_id, [paste()]);
      expect(again).toEqual({ imported: 1, skipped: 0 });
    });

    test("two concurrent saves of the same list import each row only once", async () => {
      const list = await toCreateList();
      const results = await Promise.all([
        TransactionService.createTransactionsInBulk(user.user_id, list.map((t) => ({ ...t }))),
        TransactionService.createTransactionsInBulk(user.user_id, list.map((t) => ({ ...t }))),
      ]);
      expect(results[0].imported + results[1].imported).toBe(FIXTURE_ROWS);
      expect(results[0].skipped + results[1].skipped).toBe(FIXTURE_ROWS);
      expect(await prisma.transactions.count({ where: { external_id: { startsWith: "phonepe:" } } })).toBe(
        FIXTURE_ROWS
      );
    }, 60_000);

    test("saves 300 rows in one call", async () => {
      const list: Array<CreateTransactionType> = Array.from({ length: 300 }, (_, i) => ({
        amount: i + 1,
        type: MYFIN.TRX_TYPES.EXPENSE,
        description: `Paid to MERCHANT ${i}`,
        entity_id: undefined,
        account_from_id: bank3300.account_id,
        account_to_id: undefined,
        category_id: undefined,
        date_timestamp: 1790000000 + i * 60,
        is_essential: false,
        external_id: `phonepe:TBULK${String(i).padStart(6, "0")}:DEBIT`,
      }));
      const res = await TransactionService.createTransactionsInBulk(user.user_id, list);
      expect(res).toEqual({ imported: 300, skipped: 0 });
      expect(await prisma.transactions.count()).toBe(300);
      expect(await balanceOf(bank3300.account_id)).toBe(-((300 * 301) / 2) * 100);
    }, 120_000);

    test("bulk save leaves the same balances and snapshots as saving rows one by one", async () => {
      const list = await toCreateList();
      await TransactionService.createTransactionsInBulk(user.user_id, list.map((t) => ({ ...t })));

      const accounts = [bank3300, upiLite, card2001, other];
      const snapshotsOf = async () => {
        const out = [];
        for (const a of accounts) {
          const rows = await prisma.balances_snapshot.findMany({
            where: { accounts_account_id: a.account_id },
            orderBy: [{ year: "asc" }, { month: "asc" }],
          });
          out.push({
            balance: await balanceOf(a.account_id),
            snapshots: rows.map((r) => `${r.year}-${r.month}:${Number(r.balance)}`),
          });
        }
        return out;
      };
      const bulk = await snapshotsOf();

      await prisma.balances_snapshot.deleteMany();
      await prisma.transactions.deleteMany();
      await prisma.accounts.updateMany({ data: { current_balance: 0 } });
      for (const t of list) await TransactionService.createTransaction(user.user_id, { ...t });

      expect(bulk).toEqual(await snapshotsOf());
      expect(bulk[0].balance).not.toBe(0);
    }, 120_000);

    test("external_id survives backup and restore, so re-uploading finds no new rows", async () => {
      await TransactionService.createTransactionsInBulk(user.user_id, await toCreateList());
      const backup = await UserService.backupUser(user.user_id);
      await UserService.restoreUser(user.user_id, backup);

      expect(await prisma.transactions.count({ where: { external_id: { startsWith: "phonepe:" } } })).toBe(
        FIXTURE_ROWS
      );
      const preview = await PhonePeImportService.previewPhonePeImport(user.user_id, fixture);
      expect(preview.new_rows).toBe(0);
      expect(preview.duplicate_rows).toBe(FIXTURE_ROWS);
    }, 60_000);
  });
});
