/**
 * Kontroly duplicit podle parametrů: číslo faktury dodavatele (u téhož dodavatele) — odmítnout / varovat /
 * odmítnout ve stejném roce; číslo dokladu v hlavní knize — odmítnout, nebo přijmout (opravný deník).
 */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { inTenant, listRecords, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { postVoucher } from "@/modules/gl/posting";

const client = createPrisma();
const run = Date.now().toString(36);

describe("kontroly duplicit", () => {
  it("číslo faktury dodavatele a číslo dokladu v účetnictví podle parametrů", async () => {
    const T = (await provisionTenant(client, { code: `t-dup-${run}`, name: "Dup", adminEmail: `dup-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap"], company: { code: "D", name: "D" } })).ctx;
    const grp = (await listRecords(T, "ap.group", {}, client)).rows[0];
    const mk = async (name: string) => saveRecord(T, "ap.vendor", null, { subjectId: (await saveRecord(T, "gab.subject", null, { name }, undefined, client)).id, groupId: grp.id }, undefined, client);
    const v1 = await mk("Dodavatel 1");
    const v2 = await mk("Dodavatel 2");
    await saveRecord(T, "ap.invoice", null, { vendorId: v1.id, externalNum: "F-100", invoiceDate: "2026-11-01" }, undefined, client);
    // výchozí: odmítnout (u téhož dodavatele), jiný dodavatel smí
    await expect(saveRecord(T, "ap.invoice", null, { vendorId: v1.id, externalNum: "F-100", invoiceDate: "2026-11-02" }, undefined, client)).rejects.toMatchObject({ label: "@SYS:FixErrors" });
    await saveRecord(T, "ap.invoice", null, { vendorId: v2.id, externalNum: "F-100", invoiceDate: "2026-11-02" }, undefined, client);
    // varovat: uloží se, varování v kontextu
    // parametry zakládá výchozí nastavení (profil darů); druhé parametry nejdou
    const [p0] = (await listRecords(T, "ap.parameters", {}, client)).rows;
    const p = await saveRecord(T, "ap.parameters", String(p0.id), { ...p0, invoiceNumCheck: "warn" }, undefined, client);
    await expect(saveRecord(T, "ap.parameters", null, { invoiceNumCheck: "warn" }, undefined, client)).rejects.toMatchObject({ label: "@GL:OneParameters" });
    const W = { ...T, warnings: [] as string[] };
    await saveRecord(W, "ap.invoice", null, { vendorId: v1.id, externalNum: "F-100", invoiceDate: "2026-11-03" }, undefined, client);
    expect(W.warnings).toEqual(["Faktura F-100 už existuje — uloženo i tak."]);
    // odmítnout ve stejném roce: jiný rok projde
    await saveRecord(T, "ap.parameters", String(p.id), { ...p, invoiceNumCheck: "rejectYear" }, undefined, client);
    await saveRecord(T, "ap.invoice", null, { vendorId: v1.id, externalNum: "F-100", invoiceDate: "2027-01-05" }, undefined, client);
    await expect(saveRecord(T, "ap.invoice", null, { vendorId: v1.id, externalNum: "F-100", invoiceDate: "2026-12-01" }, undefined, client)).rejects.toMatchObject({ label: "@SYS:FixErrors" });

    // hlavní kniha: ruční číslo dokladu podruhé — výchozí odmítnout, s „přijmout“ opravný doklad projde
    const acc = async (n: string) => String((await listRecords(T, "gl.account", { filter: { accountNum: n } }, client)).rows[0].id);
    const lines = [{ accountId: await acc("518000"), amount: "100" }, { accountId: await acc("395000"), amount: "-100" }];
    const post = () => inTenant(T, (s) => postVoucher(s.sys().api(), { date: "2026-11-10", voucherNum: "OPR-1", lines }), client);
    await post();
    await expect(post()).rejects.toMatchObject({ label: "@GL:VoucherDuplicate" });
    const [gp] = (await listRecords(T, "gl.parameters", {}, client)).rows;
    await saveRecord(T, "gl.parameters", String(gp.id), { ...gp, voucherDupCheck: "accept" }, undefined, client);
    await post();
    expect((await listRecords(T, "gl.voucher", { filter: { voucherNum: "OPR-1" } }, client)).total).toBe(2);
  }, 120_000);
});
