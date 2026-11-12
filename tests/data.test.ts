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
import { withTenant } from "@/server/db";
import { addFile, addNote, listDocuRefs, readFile } from "@/server/docuref";
import { recordHistory } from "@/server/history";
import { setupCompany } from "@/server/setup";
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
      modules: ["gab", "tax"],
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
    await expectUserError(saveRecord(A, "gl.account", null, { accountNum: "211", name: "dup", type: "asset" }, undefined, client), "@SYS:Duplicate");
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
    const accs = (await listRecords(accountant, "gl.account", { filters: { accountNum: "211, 411" } }, client)).rows;
    const byNum = Object.fromEntries(accs.map((a) => [a.accountNum, a.id]));
    await saveRecord(accountant, "gl.journalLine", null, { journalId: j.id, accountId: byNum["211"], debit: "10" }, undefined, client);
    await saveRecord(accountant, "gl.journalLine", null, { journalId: j.id, accountId: byNum["411"], credit: "10" }, undefined, client);
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
    expect(seqs.map((x) => `${x.code}:${x.usedFor}`).sort()).toEqual(["GLJOURNAL:gl.journal", "GLVOUCHER:gl.voucher"]);
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
    const accs = Object.fromEntries((await listRecords(A, "gl.account", { filters: { accountNum: "221, 395, 518" } }, client)).rows.map((a) => [a.accountNum, a.id]));
    const jn = await saveRecord(A, "gl.journalName", null, { code: "BAN", name: "Banka", voucherSeqId: vs.id, offsetAccountId: accs["221"] }, undefined, client);

    const j = await saveRecord(A, "gl.journal", null, { date: "2026-11-12", description: "Poplatek", journalNameId: jn.id }, undefined, client);
    expect(j.journalNum).toBe("MD-0001");
    // jen jedna strana — rozdíl vyrovná protiúčet z nastavení deníku
    await saveRecord(A, "gl.journalLine", null, { journalId: j.id, accountId: accs["518"], debit: "150" }, undefined, client);
    await runAction(A, "gl.journal", String(j.id), "post", client);
    const posted = await getRecord(A, "gl.journal", String(j.id), client);
    const v = await getRecord(A, "gl.voucher", String(posted!.voucherId), client);
    expect(v!.voucherNum).toBe("BV26/001");
    const tr = await listRecords(A, "gl.trans", { filter: { voucherId: v!.id } }, client);
    expect(tr.rows.map((r) => `${r._titles && (r._titles as Record<string, string>).accountId}:${r.amount}`).sort()).toEqual(["221:-150.00", "518:150.00"]);

    // deník bez názvu dostane GEN
    const j2 = await saveRecord(A, "gl.journal", null, { date: "2026-11-12", description: "Bez názvu" }, undefined, client);
    expect((j2._titles as Record<string, string> | undefined)?.journalNameId ?? (await getRecord(A, "gl.journal", String(j2.id), client))!._titles).toBeTruthy();
    // vrátit původní nastavení řad pro ostatní testy
    const [moje] = (await listRecords(A, "sys.numberSeq", { filters: { code: "MOJE" } }, client)).rows;
    await saveRecord(A, "sys.numberSeq", String(moje.id), { usedFor: null }, undefined, client);
    await saveRecord(A, "sys.numberSeq", String(old.id), { usedFor: "gl.journal" }, undefined, client);
  });
});

describe("historie změn", () => {
  it("založení, změna s popisky polí a titulky odkazů, přílohy", async () => {
    const t = (ref?: string) => resolveLabel(labelTable, ref, "cs");
    const s1 = await saveRecord(A, "gab.subject", null, { name: "Historie" }, undefined, client);
    await saveRecord(A, "gab.subject", String(s1.id), { name: "Historie 2", vatId: "CZ12345678" }, undefined, client);
    await addNote(A, "gab.subject", String(s1.id), "Pozn", "text", client);
    const [acc] = (await listRecords(A, "gl.account", { filters: { accountNum: "343" } }, client)).rows;
    const code = await saveRecord(A, "tax.taxCode", null, { code: "HX", name: "x", rate: "0", direction: "output", accountId: acc.id }, undefined, client);

    const h = await recordHistory(A, "gab.subject", String(s1.id), t, "cs", client);
    expect(h.map((e) => e.action)).toEqual(["docuref", "update", "create"]);
    const upd = h[1].changes;
    expect(upd).toContainEqual({ label: "Název", from: "Historie", to: "Historie 2" });
    expect(upd).toContainEqual({ label: "DIČ", from: "", to: "CZ12345678" });
    const hc = await recordHistory(A, "tax.taxCode", String(code.id), t, "cs", client);
    expect(hc[0].changes).toContainEqual({ label: "Účet DPH", from: "", to: "343" });
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
    const codes = await listRecords(A, "tax.taxCode", { filters: { accountId: "343", rate: "> 15" } }, client);
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
      ["211", "1000", ""],
      ["411", "", "1000"],
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
      ["211", "500", ""],
      ["411", "", "499.50"],
    ]);
    const err = await expectUserError(runAction(A, "gl.journal", String(j.id), "post", client), "@GL:NotBalanced");
    expect(err.params.diff).toBe("0.50");
    const still = await getRecord(A, "gl.journal", String(j.id), client);
    expect(still!.status).toBe("draft");
  });

  it("účet použitý v zápisech nejde smazat", async () => {
    const [cash] = (await listRecords(A, "gl.account", { filter: { accountNum: "211" } }, client)).rows;
    await expectUserError(deleteRecord(A, "gl.account", String(cash.id), client), "@SYS:InUse");
  });
});
