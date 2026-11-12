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
    expect(sorted.total).toBe(4);
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
