/**
 * Integrační testy datové služby proti skutečnému Postgresu
 * (lokálně: npm run db:local, pak npx prisma migrate deploy && npx tsx scripts/rls.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserError } from "@/core/module";
import { createPrisma } from "@/server/db";
import {
  deleteRecord,
  getRecord,
  listRecords,
  runAction,
  saveRecord,
  type Ctx,
} from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { downloadFile } from "@/server/data";
import { importRecords, parseCsv, readTable } from "@/server/import";
import { receiptPrint, sell, type ReceiptPrint } from "@/modules/pos/sale";
import { withTenant } from "@/server/db";
import { addFile, addNote, listDocuRefs, readFile } from "@/server/docuref";
import { recordHistory } from "@/server/history";
import { setupCompany } from "@/server/setup";
import { convertCents, parseCnb } from "@/modules/sys/currency";
import { checkStatement, gpcHeader, gpcLine, parseGpc } from "@/modules/bank/gpc";
import { gpcAccountKey } from "@/modules/bank/handlers";
import { fromCents } from "@/core/money";
import { inTenant } from "@/server/data";
import { resolveLabel } from "@/core/labels";
import { labelTable } from "@/registry";

const client = createPrisma();
const run = Date.now().toString(36);
let A: Ctx;
let B: Ctx;

async function expectUserError(p: Promise<unknown>, label: string, field?: string) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(UserError);
    const ue = e as UserError;
    if (field) expect(ue.fields?.[field]).toBe(label);
    else expect(ue.label).toBe(label);
    return ue;
  }
  throw new Error(`očekávána chyba ${label}`);
}

beforeAll(async () => {
  const mk = (x: string) =>
    provisionTenant(client, {
      code: `t-${x}-${run}`,
      name: `Tenant ${x}`,
      adminEmail: `admin-${x}-${run}@test.local`,
      adminPassword: "heslo-12345",
      modules: ["gab", "tax", "ar", "ap", "bank"],
      company: { code: x.toUpperCase(), name: `Firma ${x}` },
    });
  A = (await mk("a")).ctx;
  B = (await mk("b")).ctx;
});

afterAll(() => client.$disconnect());

describe("izolace tenantů", () => {
  it("tenant nevidí data jiného tenanta ani přes přímý dotaz", async () => {
    const s = await saveRecord(A, "gab.subject", null, { name: "Alfa s.r.o.", regNo: "12345678" }, undefined, client);
    expect(await getRecord(B, "gab.subject", String(s.id), client)).toBeNull();
    const listB = await listRecords(B, "gab.subject", { q: "Alfa" }, client);
    expect(listB.total).toBe(0);
    // i kdyby kód zapomněl filtr, RLS vrátí jen data tenanta B
    const raw = await withTenant(B.tenantId, (tx) => tx.gabSubject.findMany({ where: { id: String(s.id) } }), client);
    expect(raw).toEqual([]);
  });

  it("odkaz na záznam jiného tenanta odmítne", async () => {
    const [accA] = (await listRecords(A, "gl.account", { q: "Pokladna" }, client)).rows;
    const [vatB] = (await listRecords(B, "gl.account", { q: "Daň" }, client)).rows;
    await expectUserError(
      saveRecord(A, "tax.taxCode", null, { code: "X", name: "x", rate: "0", direction: "output", accountId: vatB.id }, undefined, client),
      "@SYS:InvalidValue",
      "accountId",
    );
    expect(accA).toBeTruthy();
  });
});

describe("objekty", () => {
  it("validuje typy, povinná pole a unikátnost", async () => {
    await expectUserError(saveRecord(A, "gab.subject", null, { name: "" }, undefined, client), "@SYS:Required", "name");
    await expectUserError(saveRecord(A, "gab.subject", null, { name: "X", vatId: "123" }, undefined, client), "@SYS:InvalidVatId", "vatId");
    await expectUserError(saveRecord(A, "gl.account", null, { accountNum: "211000", name: "dup", type: "asset" }, undefined, client), "@SYS:Duplicate");
  });

  it("hlídá souběžné úpravy", async () => {
    const s = await saveRecord(A, "gab.subject", null, { name: "Beta" }, undefined, client);
    await saveRecord(A, "gab.subject", String(s.id), { name: "Beta 2" }, s.version as number, client);
    await expectUserError(saveRecord(A, "gab.subject", String(s.id), { name: "Beta 3" }, s.version as number, client), "@SYS:Conflict");
  });

  it("vypnutý modul není dostupný", async () => {
    const noTax: Ctx = { ...A, modules: new Set(["sys", "gab", "gl"]) };
    await expectUserError(listRecords(noTax, "tax.taxCode", {}, client), "@SYS:InvalidValue");
  });

  it("systémové objekty nejdou zakládat ručně", async () => {
    await expectUserError(saveRecord(A, "gl.voucher", null, { voucherNum: "X", date: "2026-01-01" }, undefined, client), "@SYS:InvalidValue");
  });
});

describe("oprávnění", () => {
  const as = (levels: Record<string, "read" | "write" | "delete">): Ctx => ({ ...A, role: "user", perms: { admin: false, levels } });

  it("čtení bez zápisu", async () => {
    const reader = as({ gab: "read" });
    expect((await listRecords(reader, "gab.subject", {}, client)).total).toBeGreaterThan(0);
    await expectUserError(saveRecord(reader, "gab.subject", null, { name: "Zakázáno" }, undefined, client), "@SYS:NoAccess");
    await expectUserError(listRecords(reader, "gl.account", {}, client), "@SYS:NoAccess");
  });

  it("oprávnění na objekt má přednost před modulem; mazání jen s úrovní delete", async () => {
    const u = as({ gab: "read", "gab.contact": "delete" });
    const [subj] = (await listRecords(A, "gab.subject", { pageSize: 1 }, client)).rows;
    const c = await saveRecord(u, "gab.contact", null, { subjectId: subj.id, kind: "email", value: "a@b.cz" }, undefined, client);
    await deleteRecord(u, "gab.contact", String(c.id), client);
    const w = as({ gab: "write" });
    const s2 = await saveRecord(w, "gab.subject", null, { name: "Smí zapsat" }, undefined, client);
    await expectUserError(deleteRecord(w, "gab.subject", String(s2.id), client), "@SYS:NoAccess");
  });

  it("účtování projde i bez práva na účetní doklady (systémová operace)", async () => {
    const accountant = as({ gl: "read", "gl.journal": "write", "gl.journalLine": "write" });
    const j = await saveRecord(accountant, "gl.journal", null, { date: "2026-11-12", description: "Bez práv na doklad" }, undefined, client);
    const accs = (await listRecords(accountant, "gl.account", { filters: { accountNum: "395000, 411000" } }, client)).rows;
    const byNum = Object.fromEntries(accs.map((a) => [a.accountNum, a.id]));
    await saveRecord(accountant, "gl.journalLine", null, { journalId: j.id, accountId: byNum["395000"], debit: "10" }, undefined, client);
    await saveRecord(accountant, "gl.journalLine", null, { journalId: j.id, accountId: byNum["411000"], credit: "10" }, undefined, client);
    await runAction(accountant, "gl.journal", String(j.id), "post", client);
    expect((await getRecord(accountant, "gl.journal", String(j.id), client))!.status).toBe("posted");
    await expectUserError(deleteRecord(accountant, "gl.journal", String(j.id), client), "@SYS:NoAccess");
  });

  it("role, oprávnění a firmy smí měnit jen superuživatel", async () => {
    const sysAll = as({ sys: "delete" });
    await expectUserError(listRecords(sysAll, "sys.role", {}, client), "@SYS:NoAccess");
    await expectUserError(saveRecord(sysAll, "sys.role", null, { code: "HACK", name: "x" }, undefined, client), "@SYS:NoAccess");
    await expectUserError(listRecords(sysAll, "sys.company", {}, client), "@SYS:NoAccess");
    expect((await listRecords(sysAll, "sys.numberSeq", {}, client)).total).toBeGreaterThan(0);
  });

  it("správce firmy smí ve firmě vše kromě rolí a firem", async () => {
    const ca: Ctx = { ...A, role: "user", perms: { admin: false, companyAdmin: true, levels: {} } };
    const j = await saveRecord(ca, "gl.journal", null, { date: "2026-11-12", description: "Správce firmy" }, undefined, client);
    await deleteRecord(ca, "gl.journal", String(j.id), client);
    await expectUserError(saveRecord(ca, "sys.role", null, { code: "CA", name: "x" }, undefined, client), "@SYS:NoAccess");
    await expectUserError(saveRecord(ca, "sys.company", null, { code: "NEW", name: "Nová" }, undefined, client), "@SYS:NoAccess");
  });
});

describe("přílohy (DocuRef)", () => {
  it("poznámka a soubor: přidat, číst, smazat; jiný tenant ani čtenář bez práva", async () => {
    const subj = await saveRecord(A, "gab.subject", null, { name: "S přílohou" }, undefined, client);
    const id = String(subj.id);
    await addNote(A, "gab.subject", id, "", "Volat po 15. hodině", client);
    await addFile(A, "gab.subject", id, { name: "../../smlouva.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 test") }, client);
    const items = await listDocuRefs(A, "gab.subject", id, client);
    expect(items.map((i) => i.kind).sort()).toEqual(["file", "note"]);
    const file = items.find((i) => i.kind === "file")!;
    expect(file.name).toBe("smlouva.pdf");
    expect((await readFile(A, file.id, client)).data.toString()).toBe("%PDF-1.4 test");

    // jiný tenant: záznam „neexistuje“, soubor taky ne
    await expectUserError(listDocuRefs(B, "gab.subject", id, client), "@SYS:NotFound");
    await expectUserError(readFile(B, file.id, client), "@SYS:NotFound");
    // čtenář vidí, ale nepřidá
    const reader: Ctx = { ...A, role: "user", perms: { admin: false, levels: { gab: "read" } } };
    expect((await listDocuRefs(reader, "gab.subject", id, client)).length).toBe(2);
    await expectUserError(addNote(reader, "gab.subject", id, "", "x", client), "@SYS:NoAccess");
    // příliš velký soubor
    await expectUserError(
      addFile(A, "gab.subject", id, { name: "big.bin", type: "", data: Buffer.alloc(11 * 1024 * 1024) }, client),
      "@SYS:FileTooLarge",
    );
    // smazání záznamu smaže i přílohy a obsah souboru
    await deleteRecord(A, "gab.subject", id, client);
    const left = await withTenant(A.tenantId, (tx) => tx.sysDocuRef.count({ where: { recordId: id } }), client);
    expect(left).toBe(0);
    await expectUserError(readFile(A, file.id, client), "@SYS:NotFound");
  });
});

describe("číselné řady a výchozí nastavení", () => {
  it("nová firma dostane řady s Použitím, účty, deník GEN a DPH; opakované spuštění nic nepřidá", async () => {
    const seqs = (await listRecords(A, "sys.numberSeq", {}, client)).rows;
    expect(seqs.map((x) => `${x.code}:${x.usedFor}`).sort()).toEqual([
      "APADV:ap.advance",
      "APINV:ap.invoice",
      "APORD:ap.order",
      "APVEND:ap.vendor",
      "ARADV:ar.advance",
      "ARCUST:ar.customer",
      "ARINV:ar.invoice",
      "ARORD:ar.order",
      "BANKPO:bank.paymentOrder",
      "GLJOURNAL:gl.journal",
      "GLVOUCHER:gl.voucher",
    ]);
    expect((await listRecords(A, "ar.group", {}, client)).rows.map((g) => g.code)).toEqual(["TUZ"]);
    expect((await listRecords(A, "gl.period", {}, client)).total).toBe(12);
    expect((await listRecords(A, "gl.journalName", { filters: { code: "GEN" } }, client)).total).toBe(1);
    expect((await listRecords(A, "tax.taxCode", {}, client)).total).toBeGreaterThanOrEqual(4);
    const again = await inTenant(A, (sess) => setupCompany(sess.sys().api(), A.modules), client);
    expect(again).toEqual({});
  });

  it("tenant si určí vlastní řadu deníků (Použití) a vlastní řadu dokladů v nastavení deníku", async () => {
    const [old] = (await listRecords(A, "sys.numberSeq", { filters: { code: "GLJOURNAL" } }, client)).rows;
    await saveRecord(A, "sys.numberSeq", String(old.id), { usedFor: null }, undefined, client);
    await saveRecord(A, "sys.numberSeq", null, { code: "MOJE", name: "Moje deníky", format: "MD-{####}", usedFor: "gl.journal" }, undefined, client);
    const vs = await saveRecord(A, "sys.numberSeq", null, { code: "BANKA", name: "Bankovní doklady", format: "BV{YY}/{###}" }, undefined, client);
    const accs = Object.fromEntries((await listRecords(A, "gl.account", { filters: { accountNum: "395000, 518000" } }, client)).rows.map((a) => [a.accountNum, a.id]));
    const jn = await saveRecord(A, "gl.journalName", null, { code: "BAN", name: "Banka", voucherSeqId: vs.id, offsetAccountId: accs["395000"] }, undefined, client);

    const j = await saveRecord(A, "gl.journal", null, { date: "2026-11-12", description: "Poplatek", journalNameId: jn.id }, undefined, client);
    expect(j.journalNum).toBe("MD-0001");
    // jen jedna strana — rozdíl vyrovná protiúčet z nastavení deníku
    await saveRecord(A, "gl.journalLine", null, { journalId: j.id, accountId: accs["518000"], debit: "150" }, undefined, client);
    await runAction(A, "gl.journal", String(j.id), "post", client);
    const posted = await getRecord(A, "gl.journal", String(j.id), client);
    const v = await getRecord(A, "gl.voucher", String(posted!.voucherId), client);
    expect(v!.voucherNum).toBe("BV26/001");
    const tr = await listRecords(A, "gl.trans", { filter: { voucherId: v!.id } }, client);
    expect(tr.rows.map((r) => `${r._titles && String((r._titles as Record<string, string>).accountId).split(" · ")[0]}:${r.amount}`).sort()).toEqual(["395000:-150.00", "518000:150.00"]);

    // deník bez názvu dostane GEN
    const j2 = await saveRecord(A, "gl.journal", null, { date: "2026-11-12", description: "Bez názvu" }, undefined, client);
    expect((j2._titles as Record<string, string> | undefined)?.journalNameId ?? (await getRecord(A, "gl.journal", String(j2.id), client))!._titles).toBeTruthy();
    // vrátit původní nastavení řad pro ostatní testy
    const [moje] = (await listRecords(A, "sys.numberSeq", { filters: { code: "MOJE" } }, client)).rows;
    await saveRecord(A, "sys.numberSeq", String(moje.id), { usedFor: null }, undefined, client);
    await saveRecord(A, "sys.numberSeq", String(old.id), { usedFor: "gl.journal" }, undefined, client);
  });
});

describe("účetní období a měny", () => {
  async function journalWith(ctx: Ctx, date: string, lines: { acc: string; debit?: string; credit?: string; currencyId?: unknown }[]) {
    const j = await saveRecord(ctx, "gl.journal", null, { date, description: "Test " + date }, undefined, client);
    for (const l of lines) {
      const [a] = (await listRecords(ctx, "gl.account", { filters: { accountNum: l.acc } }, client)).rows;
      await saveRecord(ctx, "gl.journalLine", null, { journalId: j.id, accountId: a.id, debit: l.debit, credit: l.credit, currencyId: l.currencyId ?? null }, undefined, client);
    }
    return j;
  }

  it("do uzavřeného období ani mimo fiskální rok nejde účtovat", async () => {
    const [nov] = (await listRecords(A, "gl.period", { filters: { code: "2026-11" } }, client)).rows;
    expect(nov).toBeTruthy();
    await saveRecord(A, "gl.period", String(nov.id), { status: "closed" }, undefined, client);
    const j = await journalWith(A, "2026-11-12", [{ acc: "395000", debit: "1" }, { acc: "411000", credit: "1" }]);
    await expectUserError(runAction(A, "gl.journal", String(j.id), "post", client), "@GL:PeriodClosed");
    await saveRecord(A, "gl.period", String(nov.id), { status: "open" }, undefined, client);
    const j2 = await journalWith(A, "2031-01-05", [{ acc: "395000", debit: "1" }, { acc: "411000", credit: "1" }]);
    await expectUserError(runAction(A, "gl.journal", String(j2.id), "post", client), "@GL:NoPeriod");
  });

  it("řádek v EUR se zaúčtuje v CZK kurzem k datu, v zápisu zůstane částka v EUR", async () => {
    const [eur] = (await listRecords(A, "sys.currency", { filters: { code: "EUR" } }, client)).rows;
    await saveRecord(A, "sys.exchangeRate", null, { currencyId: eur.id, date: "2026-11-10", amount: 1, rate: "24.335" }, undefined, client);
    const j = await journalWith(A, "2026-11-12", [
      { acc: "261000", debit: "100", currencyId: eur.id },
      { acc: "411000", credit: "2433.50" },
    ]);
    await runAction(A, "gl.journal", String(j.id), "post", client);
    const posted = await getRecord(A, "gl.journal", String(j.id), client);
    const tr = (await listRecords(A, "gl.trans", { filter: { voucherId: posted!.voucherId } }, client)).rows;
    const bank = tr.find((t) => String((t._titles as Record<string, string>).accountId).startsWith("261000"))!;
    expect(bank.amount).toBe("2433.50");
    expect(bank.amountCur).toBe("100.00");
    expect((bank._titles as Record<string, string>).currencyId).toBe("EUR · Euro");
  });

  it("kurzovní lístek ČNB", () => {
    const sheet = parseCnb("12.11.2026 #219\nzemě|měna|množství|kód|kurz\nEMU|euro|1|EUR|24,335\nJaponsko|jen|100|JPY|15,402\n");
    expect(sheet.date).toBe("2026-11-12");
    expect(sheet.rates).toContainEqual({ code: "JPY", amount: 100, rate: "15.402" });
    expect(fromCents(convertCents("1000", "15.402", 100))).toBe("154.02");
    expect(fromCents(convertCents("19.99", "24.335", 1))).toBe("486.46");
  });
});

describe("odběratelé a dodavatelé", () => {
  const titles = (r: Record<string, unknown>) => Object.fromEntries(Object.entries((r._titles as Record<string, string>) ?? {}).map(([k, v]) => [k, String(v).split(" · ")[0]]));

  async function partner(ctx: Ctx, obj: "ar.customer" | "ap.vendor", name: string, vatId?: string) {
    const subj = await saveRecord(ctx, "gab.subject", null, { name, vatId }, undefined, client);
    const [grp] = (await listRecords(ctx, obj.replace(/\.\w+$/, ".group"), { filters: { code: "TUZ" } }, client)).rows;
    return saveRecord(ctx, obj, null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
  }

  it("vydaná faktura: DPH na řádcích, součty, zaúčtování, saldo, daňové transakce, zámek", async () => {
    const cust = await partner(A, "ar.customer", "Odběratel s.r.o.", "CZ11122233");
    expect(cust.accountNum).toMatch(/^ODB\d{5}$/);
    const inv = await saveRecord(A, "ar.invoice", null, { customerId: cust.id, invoiceDate: "2026-11-12", description: "Služby" }, undefined, client);
    expect(inv.invoiceNum).toMatch(/^FV26\d{5}$/);
    expect(inv.dueDate).toBe("2026-11-26"); // 14 dní ze skupiny
    expect(inv.taxDate).toBe("2026-11-12");
    await saveRecord(A, "ar.invoiceLine", null, { invoiceId: inv.id, description: "Konzultace", qty: "2.5", unitPrice: "1000" }, undefined, client);
    const l2 = await saveRecord(A, "ar.invoiceLine", null, { invoiceId: inv.id, description: "Doprava", qty: "1", unitPrice: "99.99" }, undefined, client);
    expect(l2.taxAmount).toBe("21.00"); // 99,99 × 21 % = 20,9979
    let h = (await getRecord(A, "ar.invoice", String(inv.id), client))!;
    expect([h.amountNet, h.taxAmount, h.amountGross]).toEqual(["2599.99", "546.00", "3145.99"]);
    await deleteRecord(A, "ar.invoiceLine", String(l2.id), client);
    h = (await getRecord(A, "ar.invoice", String(inv.id), client))!;
    expect([h.amountNet, h.taxAmount, h.amountGross]).toEqual(["2500.00", "525.00", "3025.00"]);

    await runAction(A, "ar.invoice", String(inv.id), "post", client);
    h = (await getRecord(A, "ar.invoice", String(inv.id), client))!;
    expect(h.status).toBe("posted");
    const tr = (await listRecords(A, "gl.trans", { filter: { voucherId: h.voucherId } }, client)).rows;
    expect(tr.map((t) => `${titles(t).accountId}:${t.amount}`).sort()).toEqual(["311000:3025.00", "343000:-525.00", "604000:-2500.00"]);
    const open = (await listRecords(A, "ar.trans", { filter: { customerId: cust.id }, totals: true }, client));
    expect(open.totals!.amount).toBe("3025.00");
    const tx = (await listRecords(A, "tax.trans", { filter: { sourceId: String(inv.id) } }, client)).rows;
    expect(tx.map((t) => [titles(t).taxCodeId, t.base, t.tax, t.vatId, t.direction])).toEqual([["V21", "2500.00", "525.00", "CZ11122233", "output"]]);
    // zaúčtovaná faktura ani její řádky nejdou měnit
    await expectUserError(saveRecord(A, "ar.invoice", String(inv.id), { description: "x" }, undefined, client), "@SYS:Locked");
    const [line] = (await listRecords(A, "ar.invoiceLine", { filter: { invoiceId: inv.id } }, client)).rows;
    await expectUserError(saveRecord(A, "ar.invoiceLine", String(line.id), { qty: "3" }, undefined, client), "@GL:Locked");
    // odběratele s fakturami nejde smazat (faktury se s ním nemažou)
    await expectUserError(deleteRecord(A, "ar.customer", String(cust.id), client), "@SYS:InUse");
  });

  it("přijatá faktura v EUR: náklady a DPH na vstupu v CZK, závazek, číslo dokladu dodavatele", async () => {
    const vend = await partner(A, "ap.vendor", "Dodavatel GmbH", "DE123456789");
    const [eur] = (await listRecords(A, "sys.currency", { filters: { code: "EUR" } }, client)).rows;
    await saveRecord(A, "sys.exchangeRate", null, { currencyId: eur.id, date: "2026-11-11", amount: 1, rate: "25" }, undefined, client).catch(() => null);
    const inv = await saveRecord(A, "ap.invoice", null, { vendorId: vend.id, externalNum: "INV-2026-77", invoiceDate: "2026-11-12", currencyId: eur.id }, undefined, client);
    await saveRecord(A, "ap.invoiceLine", null, { invoiceId: inv.id, description: "Licence", qty: "1", unitPrice: "100" }, undefined, client);
    await runAction(A, "ap.invoice", String(inv.id), "post", client);
    const h = (await getRecord(A, "ap.invoice", String(inv.id), client))!;
    const tr = (await listRecords(A, "gl.trans", { filter: { voucherId: h.voucherId } }, client)).rows;
    // kurz: nejnovější nejvýš 7 dní starý k datu faktury
    const rate = (await listRecords(A, "sys.exchangeRate", { filter: { currencyId: eur.id }, sort: "date", dir: "desc" }, client)).rows.find((r) => String(r.date) <= "2026-11-12")!;
    const czk = (eurAmount: number) => (Math.round(eurAmount * Number(rate.rate) * 100) / 100).toFixed(2);
    expect(tr.map((t) => `${titles(t).accountId}:${t.amount}:${t.amountCur}`).sort()).toEqual(
      [`321000:-${czk(121)}:-121.00`, `343000:${czk(21)}:21.00`, `518000:${czk(100)}:100.00`].sort(),
    );
    const tx = (await listRecords(A, "tax.trans", { filter: { sourceId: String(inv.id) } }, client)).rows;
    expect(tx[0].documentNum).toBe("INV-2026-77");
    expect(tx[0].direction).toBe("input");
  });
});

describe("banka a úhrady", () => {
  const T = (r: Record<string, unknown>) => Object.fromEntries(Object.entries((r._titles as Record<string, string>) ?? {}).map(([k, v]) => [k, String(v).split(" · ")[0]]));
  const c = (v: string) => BigInt(Math.round(Number(v) * 100));

  function gpc(num: string, opening: string, lines: { amount: string; vs: string; msg: string }[], account = "123456789") {
    const cents = lines.map((l) => c(l.amount));
    const credit = cents.filter((x) => x > BigInt(0)).reduce((a, b) => a + b, BigInt(0));
    const debit = -cents.filter((x) => x < BigInt(0)).reduce((a, b) => a + b, BigInt(0));
    const o = c(opening);
    return Buffer.from(
      [
        gpcHeader({ account, name: "Firma", num, date: "2026-11-12", opening: o, closing: o + credit - debit, debit, credit }),
        ...lines.map((l, i) => gpcLine({ counter: "998877" + i, cents: cents[i], vs: l.vs, date: "2026-11-12", message: l.msg })),
      ].join("\r\n"),
    );
  }

  it("GPC: pozice polí, znaménka, kontrola součtů, číslo účtu", () => {
    const [st] = parseGpc(gpc("7", "1000", [{ amount: "250.50", vs: "123", msg: "Platba" }, { amount: "-19.90", vs: "", msg: "Poplatek" }]).toString());
    expect([st.account, st.statementNum, st.date]).toEqual(["123456789", "007", "2026-11-12"]);
    expect(st.lines.map((l) => [l.cents, l.vs, l.message])).toEqual([[BigInt(25050), "123", "Platba"], [BigInt(-1990), null, "Poplatek"]]);
    expect(checkStatement(st)).toBeNull();
    st.lines[0].cents = BigInt(25051);
    expect(checkStatement(st)).toContain("příjmy");
    expect(gpcAccountKey("19-123456789/0800")).toBe("190123456789"); // 000019 + 0123456789
    expect(gpcAccountKey("123456789/0100")).toBe("123456789");
  });

  it("import, automatické párování, ruční protiúčet, zaúčtování úhrad do salda", async () => {
    const accs = Object.fromEntries((await listRecords(A, "gl.account", { filters: { accountNum: "221000, 518000" } }, client)).rows.map((a) => [a.accountNum, a.id]));
    const bankAcc = await saveRecord(A, "bank.account", null, { code: "KB", name: "Běžný účet", accountNum: "123456789/0100", glAccountId: accs["221000"] }, undefined, client);
    // faktury: odběratel (plná úhrada), odběratel (částečná), dva doklady se stejným VS (nejednoznačné), dodavatel
    const mkCust = async (name: string) => {
      const subj = await saveRecord(A, "gab.subject", null, { name }, undefined, client);
      const [grp] = (await listRecords(A, "ar.group", { filters: { code: "TUZ" } }, client)).rows;
      return saveRecord(A, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    };
    const invoice = async (obj: "ar" | "ap", partner: Record<string, unknown>, price: string, extra: Record<string, unknown> = {}) => {
      const inv = await saveRecord(A, `${obj}.invoice`, null, { [obj === "ar" ? "customerId" : "vendorId"]: partner.id, invoiceDate: "2026-11-10", ...extra }, undefined, client);
      await saveRecord(A, `${obj}.invoiceLine`, null, { invoiceId: inv.id, description: "Položka", qty: "1", unitPrice: price }, undefined, client);
      await runAction(A, `${obj}.invoice`, String(inv.id), "post", client);
      return (await getRecord(A, `${obj}.invoice`, String(inv.id), client))!;
    };
    const c1 = await mkCust("Plátce Plný");
    const c2 = await mkCust("Plátce Částečný");
    const full = await invoice("ar", c1, "1000"); // 1210 s DPH
    const part = await invoice("ar", c2, "2000"); // 2420
    const dupA = await invoice("ar", c1, "100", { vs: "777777" });
    await invoice("ar", c2, "100", { vs: "777777" });
    const vsubj = await saveRecord(A, "gab.subject", null, { name: "Dodavatel Úhrady" }, undefined, client);
    const [vgrp] = (await listRecords(A, "ap.group", { filters: { code: "TUZ" } }, client)).rows;
    const vend = await saveRecord(A, "ap.vendor", null, { subjectId: vsubj.id, groupId: vgrp.id }, undefined, client);
    const vinv = await invoice("ap", vend, "500", { externalNum: "DF-2026-0042" }); // 605, VS 20260042

    const file = gpc("001", "50000", [
      { amount: "1210", vs: String(full.vs), msg: "Úhrada plná" },
      { amount: "1000", vs: String(part.vs), msg: "Úhrada část" },
      { amount: "121", vs: "777777", msg: "Nejasné" },
      { amount: "-605", vs: "20260042", msg: "Dodavatel" },
      { amount: "-45", vs: "", msg: "Poplatek" },
    ]);
    // jiný účet a vadné součty se odmítnou
    await expectUserError(runAction(A, "bank.account", String(bankAcc.id), "import", client, { name: "x.gpc", data: gpc("002", "0", [{ amount: "1", vs: "1", msg: "x" }], "999") }), "@BANK:ImportOtherAccount");
    const broken = Buffer.from(file.toString().replace("00000121000", "00000121100"));
    await expectUserError(runAction(A, "bank.account", String(bankAcc.id), "import", client, { name: "x.gpc", data: broken }), "@BANK:ImportCheck");

    await runAction(A, "bank.account", String(bankAcc.id), "import", client, { name: "vypis.gpc", data: file });
    await expectUserError(runAction(A, "bank.account", String(bankAcc.id), "import", client, { name: "vypis.gpc", data: file }), "@BANK:ImportDuplicate");
    const [st] = (await listRecords(A, "bank.statement", { filter: { bankAccountId: bankAcc.id } }, client)).rows;
    expect([st.openingBalance, st.credit, st.debit, st.closingBalance]).toEqual(["50000.00", "2331.00", "650.00", "51681.00"]);
    const lines = (await listRecords(A, "bank.statementLine", { filter: { statementId: st.id }, sort: "lineNum" }, client)).rows;
    expect(lines.map((l) => l.matchKind)).toEqual(["customer", "customer", "none", "vendor", "none"]);

    // nespárované řádky zastaví zaúčtování
    await expectUserError(runAction(A, "bank.statement", String(st.id), "post", client), "@BANK:Unmatched");
    // nejasný VS: ručně k faktuře dupA, poplatek na účet 518
    const [dupTrans] = (await listRecords(A, "ar.trans", { filter: { invoiceId: dupA.id } }, client)).rows;
    await expectUserError(saveRecord(A, "bank.statementLine", String(lines[4].id), { customerTransId: dupTrans.id }, undefined, client), "@BANK:WrongDirection", "customerTransId");
    await saveRecord(A, "bank.statementLine", String(lines[2].id), { customerTransId: dupTrans.id }, undefined, client);
    await saveRecord(A, "bank.statementLine", String(lines[4].id), { offsetAccountId: accs["518000"] }, undefined, client);
    await runAction(A, "bank.statement", String(st.id), "post", client);

    const posted = (await getRecord(A, "bank.statement", String(st.id), client))!;
    expect(posted.status).toBe("posted");
    const gl = (await listRecords(A, "gl.trans", { filter: { voucherId: posted.voucherId }, totals: true }, client));
    expect(gl.totals!.amount).toBe("0.00");
    expect(gl.rows.filter((t) => T(t).accountId === "221000").map((t) => t.amount).sort()).toEqual(["-45.00", "-605.00", "1000.00", "121.00", "1210.00"].sort());

    // saldo: plně uhrazená vyrovnaná, částečná zbývá 1420, dodavatel vyrovnán
    const fullInv = (await getRecord(A, "ar.invoice", String(full.id), client))!;
    expect(fullInv.paidAmount).toBe("1210.00");
    const [fullTrans] = (await listRecords(A, "ar.trans", { filter: { invoiceId: full.id, kind: "invoice" } }, client)).rows;
    expect(fullTrans.closed).toBe(true);
    const [partTrans] = (await listRecords(A, "ar.trans", { filter: { invoiceId: part.id, kind: "invoice" } }, client)).rows;
    expect([partTrans.paidAmount, partTrans.closed]).toEqual(["1000.00", false]);
    const c2Balance = await listRecords(A, "ar.trans", { filter: { customerId: c2.id }, totals: true }, client);
    expect(c2Balance.totals!.amount).toBe(String((2420 - 1000 + 121).toFixed(2)));
    const [vTrans] = (await listRecords(A, "ap.trans", { filter: { invoiceId: vinv.id, kind: "invoice" } }, client)).rows;
    expect(vTrans.closed).toBe(true);
    const vBalance = await listRecords(A, "ap.trans", { filter: { vendorId: vend.id }, totals: true }, client);
    expect(vBalance.totals!.amount).toBe("0.00");
    // zaúčtovaný výpis nejde měnit
    await expectUserError(saveRecord(A, "bank.statementLine", String(lines[0].id), { message: "x" }, undefined, client), "@GL:Locked");
  });
});

describe("přiznání k DPH a kontrolní hlášení", () => {
  let V: Ctx;
  beforeAll(async () => {
    const r = await provisionTenant(client, {
      code: `t-vat-${run}`,
      name: "DPH s.r.o.",
      adminEmail: `vat-${run}@test.local`,
      adminPassword: "heslo-12345",
      modules: ["gab", "tax", "ar", "ap"],
      company: { code: "VAT", name: "DPH s.r.o.", vatId: "CZ27082440" },
    });
    V = r.ctx;
  });

  async function inv(kind: "ar" | "ap", name: string, vatId: string | undefined, price: string, taxDate: string, extra: Record<string, unknown> = {}) {
    const subj = await saveRecord(V, "gab.subject", null, { name, vatId }, undefined, client);
    const obj = kind === "ar" ? "ar.customer" : "ap.vendor";
    const [grp] = (await listRecords(V, `${kind}.group`, {}, client)).rows;
    const p = await saveRecord(V, obj, null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    const h = await saveRecord(V, `${kind}.invoice`, null, { [kind === "ar" ? "customerId" : "vendorId"]: p.id, invoiceDate: taxDate, taxDate, ...extra }, undefined, client);
    await saveRecord(V, `${kind}.invoiceLine`, null, { invoiceId: h.id, description: "Plnění", qty: "1", unitPrice: price }, undefined, client);
    await runAction(V, `${kind}.invoice`, String(h.id), "post", client);
    return (await getRecord(V, `${kind}.invoice`, String(h.id), client))!;
  }

  it("výpočet řádků přiznání, rozdělení dokladů do A.4/A.5/B.2/B.3, XML, uzavření", async () => {
    await saveRecord(V, "tax.parameters", null, {
      taxOfficeCode: "451",
      taxOfficeBranch: "2009",
      subjectType: "P",
      street: "Na Poříčí",
      houseNo: "1",
      city: "Praha",
      zipCode: "110 00",
      dataBoxId: "abc1234",
      preparerFirstName: "Jana",
      preparerLastName: "Účetní",
    }, undefined, client);
    await expectUserError(saveRecord(V, "tax.parameters", null, { taxOfficeCode: "452" }, undefined, client), "@TAX:OneParameters");
    await expectUserError(saveRecord(V, "tax.parameters", String((await listRecords(V, "tax.parameters", {}, client)).rows[0].id), { taxOfficeCode: "abc" }, undefined, client), "@TAX:TaxOfficeHelp", "taxOfficeCode");

    const big = await inv("ar", "Velký odběratel", "CZ12345678", "20000", "2026-11-05"); // 24 200 → A.4
    await inv("ar", "Malý odběratel", "CZ87654321", "1000", "2026-11-06"); // 1 210 → A.5
    await inv("ap", "Velký dodavatel", "CZ11223344", "10000", "2026-11-07", { externalNum: "DF-1" }); // 12 100 → B.2
    await inv("ap", "Bez DIČ", undefined, "9000", "2026-11-08", { externalNum: "DF-2" }); // 10 890 bez DIČ → B.3 + varování
    await inv("ap", "Zahraniční", "DE999999999", "500", "2026-11-09", { externalNum: "DF-3" }); // → B.3 + varování
    await inv("ar", "Jiný měsíc", "CZ12345678", "50000", "2026-10-15"); // říjen — mimo období
    // rozpracovaná faktura s DUZP v období → varování
    const [grp] = (await listRecords(V, "ar.group", {}, client)).rows;
    const s2 = await saveRecord(V, "gab.subject", null, { name: "Koncept" }, undefined, client);
    const c2 = await saveRecord(V, "ar.customer", null, { subjectId: s2.id, groupId: grp.id }, undefined, client);
    await saveRecord(V, "ar.invoice", null, { customerId: c2.id, invoiceDate: "2026-11-20", taxDate: "2026-11-20" }, undefined, client);

    await expectUserError(saveRecord(V, "tax.return", null, { kind: "dp3", year: 2026 }, undefined, client), "@TAX:PeriodRequired", "month");
    const dp3 = await saveRecord(V, "tax.return", null, { kind: "dp3", year: 2026, month: 11 }, undefined, client);
    expect(dp3.period).toBe("2026-11");
    await expectUserError(saveRecord(V, "tax.return", null, { kind: "dp3", year: 2026, month: 11 }, undefined, client), "@SYS:Duplicate");
    await runAction(V, "tax.return", String(dp3.id), "calculate", client);
    const r = (await getRecord(V, "tax.return", String(dp3.id), client))!;
    expect([r.out21Base, r.out21Tax, r.in21Base, r.in21Tax]).toEqual(["21000.00", "4410.00", "19500.00", "4095.00"]);
    expect([r.taxOut, r.deduction, r.result]).toEqual(["4410.00", "4095.00", "315.00"]);
    expect([r.a4Count, r.b2Count]).toEqual([1, 1]);
    expect(String(r.warnings)).toContain("DF-2");
    expect(String(r.warnings)).toContain("DE999999999");
    expect(String(r.warnings)).toContain("1 nezaúčtovaných faktur");

    const xml = String((await downloadFile(V, "tax.return", String(dp3.id), "xml", client)).data);
    expect(xml).toContain('<DPHDP3 verzePis="01.02">');
    expect(xml).toContain('k_uladb="B"');
    expect(xml).toContain('mesic="11"');
    expect(xml).toContain('c_ufo="451"');
    expect(xml).toContain('dic="27082440"');
    expect(xml).toContain('zkrobchjm="DPH s.r.o."');
    expect(xml).toContain('<Veta1 obrat23="21000" dan23="4410"/>');
    expect(xml).toContain('dano_da="315"');
    expect(xml).not.toMatch(/<Veta\w+ \/>/);

    const kh = await saveRecord(V, "tax.return", null, { kind: "kh", year: 2026, month: 11 }, undefined, client);
    const khXml = String((await downloadFile(V, "tax.return", String(kh.id), "xml", client)).data);
    expect(khXml).toContain('<DPHKH1 verzePis="03.01">');
    expect(khXml).not.toContain("k_uladb");
    expect(khXml).toContain(`<VetaA4 c_radku="1" dic_odb="12345678" c_evid_dd="${big.invoiceNum}" dppd="05.11.2026" zakl_dane1="20000.00" dan1="4200.00" kod_rezim_pl="0" zdph_44="N"/>`);
    expect(khXml).toContain('<VetaA5 zakl_dane1="1000.00" dan1="210.00"/>');
    expect(khXml).toContain('<VetaB2 c_radku="1" dic_dod="11223344" c_evid_dd="DF-1" dppd="07.11.2026" zakl_dane1="10000.00" dan1="2100.00" pomer="N" zdph_44="N"/>');
    expect(khXml).toContain('<VetaB3 zakl_dane1="9500.00" dan1="1995.00"/>');
    expect(khXml).toContain('<VetaC obrat23="21000.00" pln23="19500.00"/>');
    expect(khXml).not.toMatch(/VetaA4[^>]*pomer/);

    // čtvrtletí zahrne i říjen
    const q = await saveRecord(V, "tax.return", null, { kind: "dp3", year: 2026, quarter: 4 }, undefined, client);
    expect(q.period).toBe("2026-Q4");
    await runAction(V, "tax.return", String(q.id), "calculate", client);
    expect((await getRecord(V, "tax.return", String(q.id), client))!.out21Base).toBe("71000.00");

    // podané přiznání je uzavřené
    await runAction(V, "tax.return", String(dp3.id), "file", client);
    await expectUserError(saveRecord(V, "tax.return", String(dp3.id), { month: 10 }, undefined, client), "@SYS:Locked");
    await expectUserError(runAction(V, "tax.return", String(dp3.id), "calculate", client), "@SYS:Locked");
  });
});

describe("položky a import", () => {
  let I: Ctx;
  beforeAll(async () => {
    const r = await provisionTenant(client, {
      code: `t-inv-${run}`,
      name: "Uzeniny",
      adminEmail: `inv-${run}@test.local`,
      adminPassword: "heslo-12345",
      modules: ["gab", "tax", "inv", "ar"],
      company: { code: "UZ", name: "Uzeniny" },
    });
    I = r.ctx;
  });

  it("výchozí jednotky, skupina, ceny s DPH i bez", async () => {
    const units = (await listRecords(I, "inv.unit", {}, client)).rows.map((r) => r.code);
    expect(units).toEqual(expect.arrayContaining(["KS", "KG", "BAL"]));
    const [grp] = (await listRecords(I, "inv.itemGroup", {}, client)).rows;
    expect(grp.code).toBe("ZBOZI");
    const v12 = (await listRecords(I, "tax.taxCode", { filter: { code: "V12" } }, client)).rows[0];
    await saveRecord(I, "inv.itemGroup", null, { code: "UZENINY", name: "Uzeniny", taxCodeId: v12.id }, undefined, client);
  });

  it("CSV z českého Excelu (Windows-1250, středníky, čárky), aktualizace podle čísla, vše nebo nic", async () => {
    const csv = [
      "Kód;Název;Skupina;MJ;Cena;Cena včetně DPH;Prodej na váhu;EAN;Poznámka navíc",
      'SUN01;Šunka od kosti;Uzeniny;kg;459,90;ano;ano;;x',
      'PAS01;"Játrová paštika ""Babiččina"" 120 g";UZENINY;ks;"1 234,50";ne;ne;8594001234567;',
      "",
    ].join("\r\n");
    const cp1250 = Buffer.from(
      [...csv].map((ch) => ({ "Š": 0x8a, "š": 0x9a, "á": 0xe1, "í": 0xed, "č": 0xe8, "ů": 0xf9, "ó": 0xf3, "ž": 0x9e, "é": 0xe9, "ě": 0xec, "ř": 0xf8, "ý": 0xfd, "ú": 0xfa, "Č": 0xc8 })[ch] ?? ch.charCodeAt(0)),
    );
    const table = await readTable("polozky.csv", cp1250);
    expect(table.headers[1]).toBe("Název");

    const check = await importRecords(I, "inv.item", table, { dryRun: true, lang: "cs" }, client);
    expect(check.errors).toEqual([]);
    expect([check.created, check.updated, check.applied]).toEqual([2, 0, false]);
    expect(check.columns.find((c) => c.header === "Poznámka navíc")!.status).toBe("ignored");
    expect(check.columns.find((c) => c.header === "MJ")!.field).toBe("unitId");
    expect((await listRecords(I, "inv.item", {}, client)).total).toBe(0);

    const done = await importRecords(I, "inv.item", table, { dryRun: false, lang: "cs" }, client);
    expect([done.created, done.applied]).toEqual([2, true]);
    const items = (await listRecords(I, "inv.item", { sort: "itemNum" }, client)).rows;
    const sun = items.find((r) => r.itemNum === "SUN01")!;
    expect([sun.name, sun.priceGross, sun.priceNet, sun.weighed]).toEqual(["Šunka od kosti", "459.90", "410.63", true]);
    const pas = items.find((r) => r.itemNum === "PAS01")!;
    expect([pas.name, pas.priceNet, pas.priceGross, pas.ean]).toEqual(['Játrová paštika "Babiččina" 120 g', "1234.50", "1382.64", "8594001234567"]);

    // druhý import: aktualizace ceny, prázdná buňka nic nemaže; chyba = nic se neuloží
    const upd = parseCsv("Kód;Cena;EAN\nSUN01;479,90;\nNOVA;10;\nXX;abc;");
    const bad = await importRecords(I, "inv.item", upd, { dryRun: false, lang: "cs" }, client);
    expect(bad.applied).toBe(false);
    expect(bad.errors.map((e) => [e.row, e.column])).toEqual(expect.arrayContaining([[3, "Název"], [4, "Cena"]]));
    expect(bad.missing).toEqual(expect.arrayContaining(["Název", "Skupina položek", "Jednotka"]));
    expect((await listRecords(I, "inv.item", {}, client)).total).toBe(2);
    expect((await listRecords(I, "inv.item", { filter: { itemNum: "SUN01" } }, client)).rows[0].priceGross).toBe("459.90");

    const ok = await importRecords(I, "inv.item", parseCsv("Kód;Cena\nsun01;479,90"), { dryRun: false, lang: "cs" }, client);
    expect([ok.updated, ok.created]).toEqual([1, 0]);
    const sun2 = (await listRecords(I, "inv.item", { filter: { itemNum: "SUN01" } }, client)).rows[0];
    expect([sun2.priceGross, sun2.weighed, sun2.name]).toEqual(["479.90", true, "Šunka od kosti"]);

    // neznámá jednotka
    const unk = await importRecords(I, "inv.item", parseCsv("Kód,Název,Skupina,Jednotka\nX1,Test,UZENINY,tuna"), { dryRun: true, lang: "cs" }, client);
    expect(unk.errors[0]).toMatchObject({ row: 2, column: "Jednotka" });
    expect(unk.errors[0].message).toContain("tuna");
  });

  it("XML s atributy i prvky, Excel", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<polozky>
  <polozka kod="LOV01"><nazev>Lovecký salám</nazev><skupina>UZENINY</skupina><jednotka>KG</jednotka><cena>389.00</cena><s_dph>1</s_dph></polozka>
  <polozka kod="KLO01"><nazev>Klobása</nazev><skupina>UZENINY</skupina><jednotka>KG</jednotka><cena>259</cena></polozka>
</polozky>`;
    const t = await readTable("data.xml", Buffer.from(xml));
    expect(t.headers).toEqual(expect.arrayContaining(["kod", "nazev", "cena"]));
    const r = await importRecords(I, "inv.item", t, { dryRun: false, lang: "cs" }, client);
    expect(r.errors).toEqual([]);
    expect(r.created).toBe(2);
    const lov = (await listRecords(I, "inv.item", { filter: { itemNum: "LOV01" } }, client)).rows[0];
    expect([lov.priceGross, lov.priceNet]).toEqual(["389.00", "347.32"]);

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Položky");
    ws.addRow(["Číslo položky", "Název", "Skupina položek", "Jednotka", "Prodejní cena"]);
    ws.addRow(["TLA01", "Tlačenka", "UZENINY", "KG", 149.9]);
    const xr = await importRecords(I, "inv.item", await readTable("x.xlsx", Buffer.from(await wb.xlsx.writeBuffer())), { dryRun: false, lang: "cs" }, client);
    expect([xr.created, xr.errors.length]).toEqual([1, 0]);
  });

  it("položka na řádku vydané faktury doplní popis, jednotku, cenu, DPH a účet", async () => {
    const [grp] = (await listRecords(I, "ar.group", {}, client)).rows;
    const subj = await saveRecord(I, "gab.subject", null, { name: "Restaurace U Zlatého" }, undefined, client);
    const cust = await saveRecord(I, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    const inv = await saveRecord(I, "ar.invoice", null, { customerId: cust.id }, undefined, client);
    const sun = (await listRecords(I, "inv.item", { filter: { itemNum: "SUN01" } }, client)).rows[0];
    const line = await saveRecord(I, "ar.invoiceLine", null, { invoiceId: inv.id, itemId: sun.id, qty: "2,5" }, undefined, client);
    const v12 = (await listRecords(I, "tax.taxCode", { filter: { code: "V12" } }, client)).rows[0];
    const kg = (await listRecords(I, "inv.unit", { filter: { code: "KG" } }, client)).rows[0];
    const acc604 = (await listRecords(I, "gl.account", { filter: { accountNum: "604000" } }, client)).rows[0];
    expect([line.description, line.unitId, line.unitPrice, line.taxCodeId, line.revenueAccountId]).toEqual(["Šunka od kosti", kg.id, sun.priceNet, v12.id, acc604.id]);
    expect([line.amountNet, line.taxAmount]).toEqual(["1071.20", "128.54"]); // 2,5 × 428,48
    await expectUserError(saveRecord(I, "ar.invoiceLine", null, { invoiceId: inv.id, qty: "1" }, undefined, client), "@SYS:Required", "description");
  });
});

describe("pokladna", () => {
  let P: Ctx;
  let regId: string;
  const item = async (num: string, name: string, price: string, group: string, unit: string, weighed = false) => {
    const g = (await listRecords(P, "inv.itemGroup", { filter: { code: group } }, client)).rows[0];
    const u = (await listRecords(P, "inv.unit", { filter: { code: unit } }, client)).rows[0];
    return saveRecord(P, "inv.item", null, { itemNum: num, name, groupId: g.id, unitId: u.id, salesPrice: price, priceInclTax: true, weighed }, undefined, client);
  };
  beforeAll(async () => {
    const r = await provisionTenant(client, {
      code: `t-pos-${run}`,
      name: "Uzeniny",
      adminEmail: `pos-${run}@test.local`,
      adminPassword: "heslo-12345",
      modules: ["pos"],
      company: { code: "UZ", name: "Uzeniny Test", regNo: "12345678", vatId: "CZ12345678" },
    });
    P = r.ctx;
    const v12 = (await listRecords(P, "tax.taxCode", { filter: { code: "V12" } }, client)).rows[0];
    const a601 = (await listRecords(P, "gl.account", { filter: { accountNum: "601000" } }, client)).rows[0];
    await saveRecord(P, "inv.itemGroup", null, { code: "UZENINY", name: "Uzeniny", taxCodeId: v12.id, revenueAccountId: a601.id }, undefined, client);
    regId = String((await listRecords(P, "pos.register", {}, client)).rows[0].id);
  });

  it("směna, prodej na váhu i kusů, zaokrouhlení hotovosti, uzávěrka do účetnictví a DPH", async () => {
    const sun = await item("SUN", "Šunka od kosti", "459.90", "UZENINY", "KG", true);
    const pas = await item("PAS", "Paštika", "49.90", "UZENINY", "KS");
    const tas = await item("TAS", "Taška", "5", "ZBOZI", "KS");
    const api = (fn: (a: import("@/core/module").DataApi) => Promise<unknown>) => inTenant(P, (s) => fn(s.sys().api()) as Promise<never>, client);

    await expectUserError(api((a) => sell(a, { registerId: regId, payment: "cash", lines: [{ itemId: String(pas.id), qty: "1" }] })), "@POS:ShiftNotOpen");
    const shift = await saveRecord(P, "pos.shift", null, { registerId: regId, openingCash: "2000" }, undefined, client);
    await expectUserError(saveRecord(P, "pos.shift", null, { registerId: regId }, undefined, client), "@POS:ShiftAlreadyOpen");

    // 0,253 kg × 459,90 = 116,35; 2 × 49,90 = 99,80; taška 5 → 221,15 → hotově 221
    const r1 = (await api((a) =>
      sell(a, {
        registerId: regId,
        payment: "cash",
        cashGiven: "500",
        lines: [
          { itemId: String(sun.id), qty: "0.253" },
          { itemId: String(pas.id), qty: "2" },
          { itemId: String(tas.id), qty: "1" },
        ],
      }),
    )) as Record<string, unknown>;
    expect([r1.amountGross, r1.amountPaid, r1.rounding, r1.change]).toEqual(["221.15", "221.00", "-0.15", "279.00"]);
    // DPH ze zpětného výpočtu po řádcích: 116,35 → 103,88 + 12,47; 99,80 → 89,11 + 10,69; 5 → 4,13 + 0,87
    expect([r1.amountNet, r1.taxAmount]).toEqual(["197.12", "24.03"]);
    await expectUserError(api((a) => sell(a, { registerId: regId, payment: "cash", cashGiven: "100", lines: [{ itemId: String(sun.id), qty: "1" }] })), "@POS:NotEnoughCash");
    await expectUserError(api((a) => sell(a, { registerId: regId, payment: "card", lines: [{ itemId: String(pas.id), qty: "-1" }] })), "@POS:InvalidQty");
    // kartou bez zaokrouhlení
    const r2 = (await api((a) => sell(a, { registerId: regId, payment: "card", lines: [{ itemId: String(sun.id), qty: "1.5" }] }))) as Record<string, unknown>;
    expect([r2.amountGross, r2.amountPaid, r2.rounding]).toEqual(["689.85", "689.85", "0.00"]);

    const print = (await api((a) => receiptPrint(a, P.companyId, String(r1.id)))) as ReceiptPrint;
    expect(print.company).toMatchObject({ name: "Uzeniny Test", vatId: "CZ12345678" });
    expect(print.lines.map((l) => [l.description, l.qty, l.unit, l.rate])).toEqual([
      ["Šunka od kosti", "0.253", "KG", "12"],
      ["Paštika", "2", "KS", "12"],
      ["Taška", "1", "KS", "21"],
    ]);
    expect(print.vat).toEqual(expect.arrayContaining([{ rate: "12", base: "192.99", tax: "23.16" }, { rate: "21", base: "4.13", tax: "0.87" }]));

    // účtenky ručně založit nejde
    await expectUserError(saveRecord(P, "pos.receipt", null, { registerId: regId }, undefined, client), "@SYS:InvalidValue");

    await runAction(P, "pos.shift", String(shift.id), "close", client);
    const closed = (await getRecord(P, "pos.shift", String(shift.id), client))!;
    expect([closed.status, closed.receiptCount, closed.salesGross, closed.cashTotal, closed.cardTotal, closed.roundingTotal, closed.expectedCash]).toEqual([
      "closed", 2, "911.00", "221.00", "689.85", "-0.15", "2221.00",
    ]);
    const lines = (await listRecords(P, "gl.trans", { filter: { voucherId: closed.voucherId as string } }, client)).rows;
    const byAcc = async (num: string) => {
      const acc = (await listRecords(P, "gl.account", { filter: { accountNum: num } }, client)).rows[0];
      return lines.filter((l) => l.accountId === acc.id).map((l) => l.amount);
    };
    expect(await byAcc("211000")).toEqual(["221.00"]);
    expect(await byAcc("261000")).toEqual(["689.85"]);
    expect(await byAcc("548000")).toEqual(["0.15"]);
    expect((await byAcc("343000")).sort()).toEqual(["-0.87", "-97.07"]);
    const taxTrans = (await listRecords(P, "tax.trans", { filter: { sourceId: String(shift.id) } }, client)).rows;
    expect(taxTrans.every((t) => t.simplified === true)).toBe(true);

    // KH: tržba směny (911 Kč, nad limitem by byla taky) jde do A.5 bez varování
    await saveRecord(P, "tax.parameters", null, { taxOfficeCode: "451", subjectType: "P" }, undefined, client);
    const now = new Date();
    const kh = await saveRecord(P, "tax.return", null, { kind: "kh", year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }, undefined, client);
    await runAction(P, "tax.return", String(kh.id), "calculate", client);
    expect((await getRecord(P, "tax.return", String(kh.id), client))!.a4Count).toBe(0);
    const xml = String((await downloadFile(P, "tax.return", String(kh.id), "xml", client)).data);
    expect(xml).toContain('<VetaA5 zakl_dane1="4.13" dan1="0.87" zakl_dane2="808.93" dan2="97.07"/>');

    await expectUserError(runAction(P, "pos.shift", String(shift.id), "close", client), "@SYS:Locked");
    await expectUserError(api((a) => sell(a, { registerId: regId, payment: "card", lines: [{ itemId: String(pas.id), qty: "1" }] })), "@POS:ShiftNotOpen");
  });
});

describe("historie změn", () => {
  it("založení, změna s popisky polí a titulky odkazů, přílohy", async () => {
    const t = (ref?: string) => resolveLabel(labelTable, ref, "cs");
    const s1 = await saveRecord(A, "gab.subject", null, { name: "Historie" }, undefined, client);
    await saveRecord(A, "gab.subject", String(s1.id), { name: "Historie 2", vatId: "CZ12345678" }, undefined, client);
    await addNote(A, "gab.subject", String(s1.id), "Pozn", "text", client);
    const [acc] = (await listRecords(A, "gl.account", { filters: { accountNum: "343000" } }, client)).rows;
    const code = await saveRecord(A, "tax.taxCode", null, { code: "HX", name: "x", rate: "0", direction: "output", accountId: acc.id }, undefined, client);

    const h = await recordHistory(A, "gab.subject", String(s1.id), t, "cs", client);
    expect(h.map((e) => e.action)).toEqual(["docuref", "update", "create"]);
    const upd = h[1].changes;
    expect(upd).toContainEqual({ label: "Název", from: "Historie", to: "Historie 2" });
    expect(upd).toContainEqual({ label: "DIČ", from: "", to: "CZ12345678" });
    const hc = await recordHistory(A, "tax.taxCode", String(code.id), t, "cs", client);
    expect(hc[0].changes).toContainEqual({ label: "Účet DPH", from: "", to: "343000" });
    // jiný tenant historii nevidí
    await expectUserError(recordHistory(B, "gab.subject", String(s1.id), t, "cs", client), "@SYS:NotFound");
  });
});

describe("filtry gridu na serveru", () => {
  it("text, výčet podle popisku, odkaz podle titulku, řazení podle odkazu", async () => {
    await saveRecord(A, "gab.subject", null, { name: "Filtr Jedna", type: "person" }, undefined, client);
    await saveRecord(A, "gab.subject", null, { name: "Filtr Dva", type: "organization" }, undefined, client);
    const byText = await listRecords(A, "gab.subject", { filters: { name: "filtr*" } }, client);
    expect(byText.total).toBe(2);
    const byEnum = await listRecords(A, "gab.subject", { filters: { name: "filtr*", type: "osoba" }, lang: "cs" }, client);
    expect(byEnum.rows.map((r) => r.name)).toEqual(["Filtr Jedna"]);
    const notEnum = await listRecords(A, "gab.subject", { filters: { name: "filtr*", type: "!osoba" }, lang: "cs" }, client);
    expect(notEnum.rows.map((r) => r.name)).toEqual(["Filtr Dva"]);
    const codes = await listRecords(A, "tax.taxCode", { filters: { accountId: "343000", rate: "> 15" } }, client);
    expect(codes.rows.map((r) => r.code).sort()).toEqual(["P21", "V21"]);
    const sorted = await listRecords(A, "tax.taxCode", { sort: "accountId", dir: "desc" }, client);
    expect(sorted.total).toBeGreaterThanOrEqual(4);
    const nothing = await listRecords(A, "tax.taxCode", { filters: { rate: "abc" } }, client);
    expect(nothing.total).toBe(0);
  });
});

describe("rozšíření", () => {
  it("pole rozšíření se uloží do ext a projdou validací rozšíření", async () => {
    const withExt: Ctx = { ...A, extensions: new Set(["subject-rating"]) };
    const s = await saveRecord(withExt, "gab.subject", null, { name: "Gama", rating: "4" }, undefined, client);
    expect((s.ext as Record<string, unknown>).rating).toBe(4);
    await expectUserError(saveRecord(withExt, "gab.subject", null, { name: "Delta", rating: "9" }, undefined, client), "@XRATING:Range", "rating");
    // bez zapnutého rozšíření se pole ignoruje
    const plain = await saveRecord(A, "gab.subject", null, { name: "Epsilon", rating: "9" }, undefined, client);
    expect(plain.ext).toEqual({});
  });
});

describe("hlavní kniha", () => {
  async function journal(ctx: Ctx, lines: [string, string, string][]) {
    const j = await saveRecord(ctx, "gl.journal", null, { date: "2026-11-12", description: "Vklad do pokladny" }, undefined, client);
    for (const [acc, debit, credit] of lines) {
      const [a] = (await listRecords(ctx, "gl.account", { filter: { accountNum: acc } }, client)).rows;
      await saveRecord(ctx, "gl.journalLine", null, { journalId: j.id, accountId: a.id, debit, credit }, undefined, client);
    }
    return j;
  }

  it("zaúčtuje vyrovnaný deník do dokladu a deník uzamkne", async () => {
    const j = await journal(A, [
      ["395000", "1000", ""],
      ["411000", "", "1000"],
    ]);
    expect(j.journalNum).toMatch(/^DEN26-\d{5}$/);
    await runAction(A, "gl.journal", String(j.id), "post", client);
    const posted = await getRecord(A, "gl.journal", String(j.id), client);
    expect(posted!.status).toBe("posted");
    const trans = await listRecords(A, "gl.trans", { filter: { voucherId: posted!.voucherId } }, client);
    expect(trans.rows.map((t) => t.amount).sort()).toEqual(["-1000.00", "1000.00"]);
    const voucher = await getRecord(A, "gl.voucher", String(posted!.voucherId), client);
    expect(voucher!.voucherNum).toMatch(/^UD26-\d{6}$/);
    // zaúčtovaný deník ani jeho řádky nejdou měnit
    await expectUserError(saveRecord(A, "gl.journal", String(j.id), { description: "x" }, undefined, client), "@SYS:Locked");
    const lines = await listRecords(A, "gl.journalLine", { filter: { journalId: j.id } }, client);
    await expectUserError(deleteRecord(A, "gl.journalLine", String(lines.rows[0].id), client), "@GL:Locked");
  });

  it("nevyrovnaný deník nezaúčtuje a nic nezapíše", async () => {
    const j = await journal(A, [
      ["395000", "500", ""],
      ["411000", "", "499.50"],
    ]);
    const err = await expectUserError(runAction(A, "gl.journal", String(j.id), "post", client), "@GL:NotBalanced");
    expect(err.params.diff).toBe("0.50");
    const still = await getRecord(A, "gl.journal", String(j.id), client);
    expect(still!.status).toBe("draft");
  });

  it("účtový rozvrh: 6místné účty, doplnění 3 číslic, druh účtu, zákaz ručního zápisu", async () => {
    const acc = async (n: string) => (await listRecords(A, "gl.account", { filter: { accountNum: n } }, client)).rows[0];
    const cust = await acc("311000");
    expect([cust.synthetic, cust.accountClass, cust.postingType, cust.noManualEntry]).toEqual(["311", 3, "customer", true]);
    expect((await listRecords(A, "gl.account", {}, client)).rows.every((a) => String(a.accountNum).length === 6)).toBe(true);
    // 3 číslice se doplní, nová analytika převezme typ a druh od účtu stejné syntetiky
    const a2 = await saveRecord(A, "gl.account", null, { accountNum: "311100", name: "Odběratelé EU" }, undefined, client);
    expect([a2.type, a2.postingType, a2.synthetic]).toEqual(["asset", "customer", "311"]);
    const rep = await saveRecord(A, "gl.account", null, { accountNum: "514", name: "Ostatní náklady" }, undefined, client);
    expect([rep.accountNum, rep.type, rep.accountClass]).toEqual(["514000", "expense", 5]);
    await expectUserError(saveRecord(A, "gl.account", null, { accountNum: "51", name: "X" }, undefined, client), "@GL:AccountNumHelp6", "accountNum");
    // ruční deník: saldokonto nejde, po vypnutí zámku ano
    const j = await saveRecord(A, "gl.journal", null, { date: "2026-11-12", description: "Ruční" }, undefined, client);
    await expectUserError(saveRecord(A, "gl.journalLine", null, { journalId: j.id, accountId: cust.id, debit: "1" }, undefined, client), "@GL:ManualEntryDenied");
    await saveRecord(A, "gl.account", String(a2.id), { noManualEntry: false }, undefined, client);
    await saveRecord(A, "gl.journalLine", null, { journalId: j.id, accountId: a2.id, debit: "1" }, undefined, client);
  });

  it("účet použitý v zápisech nejde smazat", async () => {
    const [cash] = (await listRecords(A, "gl.account", { filter: { accountNum: "395000" } }, client)).rows;
    await expectUserError(deleteRecord(A, "gl.account", String(cash.id), client), "@SYS:InUse");
  });
});

describe("souvislá řada", () => {
  it("číslo smazaného konceptu faktury se přidělí znovu", async () => {
    const subj = await saveRecord(A, "gab.subject", null, { name: "Souvislý odběratel" }, undefined, client);
    const [grp] = (await listRecords(A, "ar.group", {}, client)).rows;
    const cust = await saveRecord(A, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    const [seq] = (await listRecords(A, "sys.numberSeq", { filter: { usedFor: "ar.invoice" } }, client)).rows;
    await saveRecord(A, "sys.numberSeq", String(seq.id), { continuous: true }, undefined, client);
    const a = await saveRecord(A, "ar.invoice", null, { customerId: cust.id }, undefined, client);
    const b = await saveRecord(A, "ar.invoice", null, { customerId: cust.id }, undefined, client);
    await deleteRecord(A, "ar.invoice", String(a.id), client);
    const free = (await listRecords(A, "sys.numberSeqFree", { filter: { seqId: seq.id } }, client)).rows;
    expect(free.map((f) => f.number)).toEqual([a.invoiceNum]);
    const c = await saveRecord(A, "ar.invoice", null, { customerId: cust.id }, undefined, client);
    expect(c.invoiceNum).toBe(a.invoiceNum);
    const d = await saveRecord(A, "ar.invoice", null, { customerId: cust.id }, undefined, client);
    expect(String(d.invoiceNum) > String(b.invoiceNum)).toBe(true);
  });
});

describe("hledání v seznamu", () => {
  it("mezery, zástupné a řídicí znaky nevadí", async () => {
    await saveRecord(A, "gab.subject", null, { name: "Hledaná Krkovice s.r.o." }, undefined, client);
    for (const q of ["  krkovice  ", "krk%", "krk_ovice", "hledaná\tkrk", "  hledaná   krkovice\n", "%%%", "\\"]) {
      const r = await listRecords(A, "gab.subject", { q }, client);
      if (/krk|hledan/i.test(q)) expect(r.rows.map((x) => x.name)).toContain("Hledaná Krkovice s.r.o.");
    }
  });
});
