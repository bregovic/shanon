/**
 * Změna data vykázání (nárok na odpočet v jiném období): přijatá faktura z ledna se vykáže v březnu,
 * daň na výstupu nejde, před DUZP a po 3 letech ne, podané období se nemění.
 */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, inTenant, listRecords, runAction, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { computeVat } from "@/modules/tax/vat-return";

const client = createPrisma();
const run = Date.now().toString(36);

describe("datum vykázání daně", () => {
  it("nárok z ledna vykázaný v březnu, hlídání pravidel", async () => {
    const T = (await provisionTenant(client, { code: `t-rd-${run}`, name: "RD", adminEmail: `rd-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "ap", "inv"], company: { code: "R", name: "RD s.r.o.", regNo: "12345678", vatId: "CZ12345678" } })).ctx;
    const C = { ...T, dims: undefined };
    const one = async (obj: string, filter: Record<string, string>) => (await listRecords(C, obj, { filter }, client)).rows[0];
    const id = async (obj: string, code: string) => String((await one(obj, { code })).id);

    const subj = await saveRecord(C, "gab.subject", null, { name: "Dodavatel CZ", vatId: "CZ87654321", regNo: "87654321" }, undefined, client);
    const vendor = await saveRecord(C, "ap.vendor", null, { subjectId: subj.id, groupId: (await one("ap.group", {})).id, taxGroupId: await id("tax.taxGroup", "TUZ") }, undefined, client);
    const inv = await saveRecord(C, "ap.invoice", null, { vendorId: vendor.id, externalNum: "F-2026-01", invoiceDate: "2026-01-20", taxDate: "2026-01-20" }, undefined, client);
    await saveRecord(C, "ap.invoiceLine", null, { invoiceId: inv.id, description: "Služba", qty: "1", unitPrice: "1000", itemTaxGroupId: await id("tax.itemTaxGroup", "S21") }, undefined, client);
    await runAction(C, "ap.invoice", String(inv.id), "post", client);
    const [tr] = (await listRecords(C, "tax.trans", { filter: { documentNum: "F-2026-01" } }, client)).rows;
    expect(tr.direction).toBe("input");

    const vat = (month: number) => inTenant(C, (s) => computeVat(s.sys().api(), { year: 2026, month }), client);
    const deduct = (c: Awaited<ReturnType<typeof vat>>) => [...c.lines.values()].reduce((a, [, tax]) => a + tax, BigInt(0));
    expect(deduct(await vat(1))).not.toBe(BigInt(0));
    expect(deduct(await vat(3))).toBe(BigInt(0));

    // před DUZP a po 3 letech ne
    await expect(runAction(C, "tax.trans", String(tr.id), "changeReportDate", client, undefined, { date: "2026-01-10" })).rejects.toMatchObject({ label: "@TAX:DeferBefore" });
    await expect(runAction(C, "tax.trans", String(tr.id), "changeReportDate", client, undefined, { date: "2029-02-01" })).rejects.toMatchObject({ label: "@TAX:DeferTooLate" });
    // bez data akce nejde
    await expect(runAction(C, "tax.trans", String(tr.id), "changeReportDate", client)).rejects.toMatchObject({ label: "@SYS:FixErrors" });

    // nárok v březnu: leden bez daně, březen s daní
    await runAction(C, "tax.trans", String(tr.id), "changeReportDate", client, undefined, { date: "2026-03-15" });
    expect(deduct(await vat(1))).toBe(BigInt(0));
    expect(deduct(await vat(3))).not.toBe(BigInt(0));
    // zpět na DUZP = datum vykázání prázdné
    await runAction(C, "tax.trans", String(tr.id), "changeReportDate", client, undefined, { date: "2026-01-20" });
    const [back] = (await listRecords(C, "tax.trans", { filter: { documentNum: "F-2026-01" } }, client)).rows;
    expect(back.reportDate ?? null).toBeNull();

    // kód bez příznaku nedovolí
    const code = (await getRecord(C, "tax.taxCode", String(tr.taxCodeId), client))!;
    await saveRecord(C, "tax.taxCode", String(code.id), { ...code, deferrable: false }, code.version as number, client);
    await expect(runAction(C, "tax.trans", String(tr.id), "changeReportDate", client, undefined, { date: "2026-03-15" })).rejects.toMatchObject({ label: "@TAX:DeferNotAllowed" });
  }, 120_000);
});
