/**
 * Deník (pořizování jako v AX): číslo dokladu hned na řádku podle číslování,
 * datum z předchozího řádku / hlavičky, záporná částka na druhou stranu,
 * druh deníku z nabídky modulu; zkratky data.
 */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, listRecords, runAction, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { parseDateInput } from "@/lib/date-input";

const client = createPrisma();
const run = Date.now().toString(36);

describe("zadání data jako v AX", () => {
  const today = new Date(2026, 10, 15); // 15. 11. 2026
  it.each([
    ["d", "2026-11-15"],
    ["T", "2026-11-15"],
    ["d+1", "2026-11-16"],
    ["d-15", "2026-10-31"],
    ["+30", "2026-12-15"],
    ["3", "2026-11-03"],
    ["0102", "2026-02-01"],
    ["310127", "2027-01-31"],
    ["29022028", "2028-02-29"],
    ["15.11.", "2026-11-15"],
    ["1.2.26", "2026-02-01"],
    ["15/11/2026", "2026-11-15"],
    ["2026-11-15", "2026-11-15"],
    ["", null],
  ])("%s → %s", (input, out) => expect(parseDateInput(input, today)).toBe(out));
  it("neplatné", () => {
    for (const x of ["31.2.", "32", "abc", "1.13.2026", "2902"]) expect(parseDateInput(x, today)).toBeUndefined();
  });
});

describe("deník: pořizování řádků", () => {
  it("číslo dokladu hned, datum, záporné částky, druh deníku podle nabídky", async () => {
    const D = (await provisionTenant(client, { code: `t-jx-${run}`, name: "JX", adminEmail: `jx-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "ap", "bank", "cash"], company: { code: "J", name: "J" } })).ctx;
    const acc = async (n: string) => String((await listRecords(D, "gl.account", { filter: { accountNum: n } }, client)).rows[0].id);
    const [a518, a395] = [await acc("518000"), await acc("395000")];
    const line = (j: Record<string, unknown>, v: Record<string, unknown>) => saveRecord(D, "gl.journalLine", null, { journalId: j.id, ...v }, undefined, client);

    // druh z nabídky (Banka → Bankovní deníky): název deníku toho druhu
    const jb = await saveRecord(D, "gl.journal", null, { journalType: "bank", date: "2026-11-13", description: "Výpis" }, undefined, client);
    const jbName = (await getRecord(D, "gl.journalName", String(jb.journalNameId), client))!;
    expect([jb.journalType, jbName.code]).toEqual(["bank", "BANKA"]);
    const jg = await saveRecord(D, "gl.journal", null, { date: "2026-11-13", description: "Obecný" }, undefined, client);
    expect(jg.journalType).toBe("daily");
    expect((await listRecords(D, "gl.journal", { filter: { journalType: "bank" } }, client)).rows.map((r) => r.id)).toEqual([jb.id]);

    // GEN (po vyrovnání): doklad se drží, dokud není vyrovnaný, pak nové číslo
    const l1 = await line(jg, { accountId: a518, debit: "100" });
    const l2 = await line(jg, { accountId: a395, credit: "60" });
    const l3 = await line(jg, { accountId: a395, debit: "-40" }); // záporné MD = D 40
    const l4 = await line(jg, { accountId: a518, debit: "10", date: "2026-11-14" });
    const l5 = await line(jg, { accountId: a395, credit: "10" });
    expect([l1.voucherNum, l2.voucherNum, l3.voucherNum].every((v) => v && v === l1.voucherNum)).toBe(true);
    expect([l3.debit, l3.credit]).toEqual([null, "40.00"]);
    expect(l4.voucherNum).not.toBe(l1.voucherNum);
    expect(l5.voucherNum).toBe(l4.voucherNum);
    // datum: první řádek z hlavičky, další z předchozího řádku
    expect([l1.date, l2.date, l4.date, l5.date]).toEqual(["2026-11-13", "2026-11-13", "2026-11-14", "2026-11-14"]);

    // zaúčtování použije čísla z řádků
    await runAction(D, "gl.journal", String(jg.id), "post", client);
    const v = (await listRecords(D, "gl.voucher", { filter: { voucherNum: String(l1.voucherNum) } }, client)).rows;
    expect(v.length).toBe(1);
    expect((await listRecords(D, "gl.voucher", { filter: { voucherNum: String(l4.voucherNum) } }, client)).rows[0].date).toBe("2026-11-14");

    // řádek s protiúčtem je vyrovnaný sám → další řádek nový doklad
    const j2 = await saveRecord(D, "gl.journal", null, { date: "2026-11-13", description: "Protiúčty" }, undefined, client);
    const p1 = await line(j2, { accountId: a518, debit: "5", offsetType: "ledger", offsetAccountId: a395 });
    const p2 = await line(j2, { accountId: a518, debit: "6", offsetType: "ledger", offsetAccountId: a395 });
    expect(p1.voucherNum).not.toBe(p2.voucherNum);

    // starší řádky bez čísla dostanou číslo při Ověřit
    await saveRecord(D, "gl.journalLine", String(p2.id), { voucherNum: null }, undefined, client);
    await runAction(D, "gl.journal", String(j2.id), "validate", client);
    expect((await getRecord(D, "gl.journalLine", String(p2.id), client))!.voucherNum).toBeTruthy();
    expect((await getRecord(D, "gl.journal", String(j2.id), client))!.checkResult).toMatch(/^V pořádku: 2 dokladů/);
  });
});
