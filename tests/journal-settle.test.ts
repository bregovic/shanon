/**
 * Vyrovnání v deníku: řádek bez partnera → dialog najde otevřené faktury podle kritérií, výběr doplní
 * odběratele, VS a částku; zaúčtování uhradí přesně vybrané částky; kontroly přeplatku a jiného partnera.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, listRecords, runAction, saveRecord, deleteRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { settleSave, settleView } from "@/server/journal-settle";

const client = createPrisma();
const run = Date.now().toString(36);
afterAll(() => client.$disconnect());

describe("vyrovnání řádku deníku", () => {
  it("najít otevřené položky, vyrovnat dvě faktury (jednu částečně), zaúčtovat", async () => {
    const C = (await provisionTenant(client, { code: `t-js-${run}`, name: "JS", adminEmail: `js-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "ap", "bank"], company: { code: "J", name: "J" } })).ctx;
    const acc = async (n: string) => String((await listRecords(C, "gl.account", { filter: { accountNum: n } }, client)).rows[0].id);
    const [grp] = (await listRecords(C, "ar.group", {}, client)).rows;
    const cust = async (name: string) => saveRecord(C, "ar.customer", null, { subjectId: (await saveRecord(C, "gab.subject", null, { name }, undefined, client)).id, groupId: grp.id }, undefined, client);
    const eva = await cust("Eva Platná");
    const jan = await cust("Jan Jiný");
    const a602 = await acc("602000");
    const a261 = await acc("261000");
    // faktury: Eva 1000 (VS 11) a 500 (VS 12), Jan 700 (VS 13)
    const j1 = await saveRecord(C, "gl.journal", null, { date: "2026-11-10", description: "Faktury" }, undefined, client);
    for (const [c, amt, vs] of [[eva, "1000", "11"], [eva, "500", "12"], [jan, "700", "13"]] as const)
      await saveRecord(C, "gl.journalLine", null, { journalId: j1.id, accountType: "customer", customerId: c.id, debit: amt, vs, offsetType: "ledger", offsetAccountId: a602 }, undefined, client);
    await runAction(C, "gl.journal", String(j1.id), "post", client);

    // úhrada: řádek bez partnera a bez částky
    const j2 = await saveRecord(C, "gl.journal", null, { date: "2026-11-20", description: "Úhrady" }, undefined, client);
    const ln = await saveRecord(C, "gl.journalLine", null, { journalId: j2.id, accountType: "ledger", offsetType: "ledger", offsetAccountId: a261, text: "Platba Eva" }, undefined, client);
    let v = await settleView(C, String(ln.id), {}, "cs", client);
    expect(v.line.partnerKind).toBeNull();
    expect(v.rows.map((r) => r.vs).sort()).toEqual(["11", "12", "13"]);
    v = await settleView(C, String(ln.id), { text: "platná" }, "cs", client);
    expect(v.rows.map((r) => r.vs).sort()).toEqual(["11", "12"]);
    expect((await settleView(C, String(ln.id), { amount: "700" }, "cs", client)).rows.map((r) => r.vs)).toEqual(["13"]);
    const t11 = v.rows.find((r) => r.vs === "11")!;
    const t12 = v.rows.find((r) => r.vs === "12")!;
    const t13 = (await settleView(C, String(ln.id), { vs: "13" }, "cs", client)).rows[0];

    // dva partneři najednou nejdou; přeplatek nejde
    await expect(settleSave(C, String(ln.id), [{ kind: "customer", transId: t11.transId, amount: "" }, { kind: "customer", transId: t13.transId, amount: "" }], client)).rejects.toMatchObject({ label: "@GL:SettleOnePartner" });
    await expect(settleSave(C, String(ln.id), [{ kind: "customer", transId: t12.transId, amount: "600" }], client)).rejects.toMatchObject({ label: "@GL:SettleTooMuch" });

    await settleSave(C, String(ln.id), [{ kind: "customer", transId: t11.transId, amount: "" }, { kind: "customer", transId: t12.transId, amount: "200" }], client);
    let line = (await getRecord(C, "gl.journalLine", String(ln.id), client))!;
    expect([line.accountType, line.customerId, line.credit, line.debit ?? null, line.settleStatus]).toEqual(["customer", eva.id, "1200.00", null, "full"]);
    v = await settleView(C, String(ln.id), {}, "cs", client);
    expect(v.line.partnerKind).toBe("customer");
    expect(v.rows.filter((r) => r.selected).map((r) => [r.vs, r.selected])).toEqual([["11", "1000.00"], ["12", "200.00"]]);
    expect(v.rows.some((r) => r.vs === "13")).toBe(false); // jen partner řádku

    // vyšší částka řádku → částečně
    line = await saveRecord(C, "gl.journalLine", String(ln.id), { credit: "1500" }, line.version as number, client);
    expect(line.settleStatus).toBe("partial");
    line = await saveRecord(C, "gl.journalLine", String(ln.id), { credit: "1200" }, line.version as number, client);
    expect(line.settleStatus).toBe("full");

    await runAction(C, "gl.journal", String(j2.id), "post", client);
    const trans = (await listRecords(C, "ar.trans", { filter: { kind: "invoice" } }, client)).rows;
    const by = (vs: string) => trans.find((x) => x.vs === vs)!;
    expect([by("11").paidAmount, by("11").closed, by("12").paidAmount, by("12").closed, by("13").paidAmount]).toEqual(["1000.00", true, "200.00", false, "0.00"]);

    // jiný partner na řádku zruší vyrovnání; smazání řádku ho smaže
    const j3 = await saveRecord(C, "gl.journal", null, { date: "2026-11-21", description: "Úhrady 2" }, undefined, client);
    const ln3 = await saveRecord(C, "gl.journalLine", null, { journalId: j3.id, accountType: "customer", customerId: eva.id, credit: "300", offsetType: "ledger", offsetAccountId: a261 }, undefined, client);
    await settleSave(C, String(ln3.id), [{ kind: "customer", transId: t12.transId, amount: "" }], client);
    expect((await getRecord(C, "gl.journalLine", String(ln3.id), client))!).toMatchObject({ settleStatus: "full", vs: "12" });
    const l3 = (await getRecord(C, "gl.journalLine", String(ln3.id), client))!;
    const l3b = await saveRecord(C, "gl.journalLine", String(ln3.id), { customerId: jan.id }, l3.version as number, client);
    expect(l3b.settleStatus).toBe("none");
    await settleSave(C, String(ln3.id), [{ kind: "customer", transId: t13.transId, amount: "300" }], client);
    await deleteRecord(C, "gl.journalLine", String(ln3.id), client);
    expect((await listRecords(C, "gl.journalSettlement", { filter: { journalId: j3.id } }, client).catch(() => ({ total: 0 }))).total).toBe(0);
  }, 120_000);
});
