/**
 * Kontakty subjektu (druh, účel, hlavní ↔ e-mail / telefon subjektu), IBAN po změně čísla účtu,
 * mazání objednávky smlouvy se zálohou spárovanou v nezaúčtovaném výpisu, QR zálohy s číslem smlouvy.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { deleteRecord, getRecord, listRecords, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";

const client = createPrisma();
const run = Date.now().toString(36);
afterAll(() => client.$disconnect());

describe("kontakty, IBAN, mazání dokladů smlouvy", () => {
  it("portál → kontakty; hlavní kontakt → subjekt; IBAN; smazání objednávky odpáruje výpis", async () => {
    const { agreementPortalInfo, agreementPortalSubmit } = await import("@/server/agreement-portal");
    const T = (await provisionTenant(client, { code: `t-cd-${run}`, name: "CD", adminEmail: `cd-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "bank", "inv", "int"], company: { code: "M", name: "Gym" } })).ctx;
    const g = (await listRecords(T, "inv.itemGroup", {}, client)).rows[0];
    const u = (await listRecords(T, "inv.unit", {}, client)).rows[0];
    await saveRecord(T, "inv.item", null, { itemNum: "C", name: "Člen", groupId: g.id, unitId: u.id, salesPrice: "1200", priceInclTax: true, agreementMonths: 1 }, undefined, client);
    const gl = (await listRecords(T, "gl.account", { filter: { accountNum: "221000" } }, client)).rows[0];
    const bank = await saveRecord(T, "bank.account", null, { code: "KB", name: "Účet", accountNum: "2000145399/0800", glAccountId: gl.id, isDefault: true }, undefined, client);
    expect(bank.iban).toBe("CZ7908000000002000145399");
    const b2 = await saveRecord(T, "bank.account", String(bank.id), { accountNum: "19-2000145399/0800" }, bank.version as number, client);
    expect(b2.iban).toBe("CZ6508000000192000145399"); // dopočtený IBAN se přepočte
    const b3 = await saveRecord(T, "bank.account", String(bank.id), { accountNum: "2000145399/0800", iban: "SK3112000000198742637541" }, b2.version as number, client);
    expect(b3.iban).toBe("SK3112000000198742637541"); // ručně zadaný zůstane

    const p = await saveRecord(T, "int.portal", null, { name: "Č", purpose: "agreement", title: "Č", agreementTerms: "x", ipHourLimit: 50 }, undefined, client);
    const info = (await agreementPortalInfo(T.tenantId, String(p.token), client))!;
    const r = (await agreementPortalSubmit(T.tenantId, String(p.token), { tariffId: info.tariffs[0].id, firstName: "Jan", lastName: "Test", email: "Jan@Example.test", phone: "+420 777 111 222", street: "A 1", city: "Praha", zipCode: "11000", startDate: "", consent: true }, "10.1.1.1", client))!;
    expect(r.payment?.qr).toContain("MSG:Smlouva SM");
    const agr = (await getRecord(T, "ar.agreement", r.agreementId!, client))!;
    const cust = (await getRecord(T, "ar.customer", String(agr.customerId), client))!;
    const subjectId = String(cust.subjectId);
    const contacts = async () => (await listRecords(T, "gab.contact", { filter: { subjectId } }, client)).rows.map((c) => [c.kind, c.value, c.isPrimary]).sort();
    expect(await contacts()).toEqual([["email", "jan@example.test", true], ["phone", "+420 777 111 222", true]]);
    // nový hlavní e-mail → subjekt; starý zůstane jako další
    await saveRecord(T, "gab.contact", null, { subjectId, kind: "email", value: "faktury@example.test", purpose: "invoice", isPrimary: true }, undefined, client);
    expect((await getRecord(T, "gab.subject", subjectId, client))!.email).toBe("faktury@example.test");
    expect((await contacts()).filter((c) => c[0] === "email")).toEqual([["email", "faktury@example.test", true], ["email", "jan@example.test", false]]);
    await expect(saveRecord(T, "gab.contact", null, { subjectId, kind: "email", value: "neplatny" }, undefined, client)).rejects.toBeTruthy();

    // objednávka smlouvy se zálohou spárovanou v nezaúčtovaném výpisu → smaže se, řádek výpisu se odpáruje
    const [adv] = (await listRecords(T, "ar.advance", { filter: { agreementId: agr.id } }, client)).rows;
    const st = await saveRecord(T, "bank.statement", null, { bankAccountId: bank.id, statementNum: "1", date: "2026-11-26", openingBalance: "0" }, undefined, client);
    const ln = await saveRecord(T, "bank.statementLine", null, { statementId: st.id, lineNum: 1, date: "2026-11-26", amount: "1200", vs: String(adv.vs), customerAdvanceId: adv.id }, undefined, client);
    await expect(deleteRecord(T, "ar.agreement", String(agr.id), client)).rejects.toMatchObject({ label: "@TAX:AgrDeleteDocsFirst" });
    await deleteRecord(T, "ar.order", String((await getRecord(T, "ar.agreement", String(agr.id), client))!.orderId), client);
    expect(await getRecord(T, "ar.advance", String(adv.id), client)).toBeNull();
    expect((await getRecord(T, "bank.statementLine", String(ln.id), client))!).toMatchObject({ matchKind: "none", customerAdvanceId: null });
    await deleteRecord(T, "ar.agreement", String(agr.id), client);
    expect(await getRecord(T, "ar.agreement", String(agr.id), client)).toBeNull();
  }, 120_000);
});
