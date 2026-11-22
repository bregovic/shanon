/**
 * Doklad k proplacení zaměstnanci: zaměstnanec má přiřazeného existujícího dodavatele (profil ZAM), na nahraném
 * dokladu se vybere zaměstnanec → zalistuje se na jeho dodavatele s profilem ZAM; na faktuře jde profil změnit na STANDARD.
 */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, listRecords, runAction, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";

const client = createPrisma();
const run = Date.now().toString(36);

describe("doklad k proplacení zaměstnanci", () => {
  it("existující dodavatel zaměstnance, zalistování s profilem ZAM, změna profilu na faktuře", async () => {
    const T = (await provisionTenant(client, { code: `t-emp-${run}`, name: "EMP", adminEmail: `emp-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap", "hr", "int"], company: { code: "H", name: "Hynek s.r.o." } })).ctx;
    const one = async (obj: string, filter: Record<string, string>) => (await listRecords(T, obj, { filter }, client)).rows[0];
    const zam = await one("ap.postingProfile", { code: "ZAM" });
    const std = await one("ap.postingProfile", { code: "STANDARD" });

    // existující dodavatel (osoba) s profilem ZAM, přiřazený zaměstnanci
    const subj = await saveRecord(T, "gab.subject", null, { name: "Václav Král", type: "person" }, undefined, client);
    const vendor = await saveRecord(T, "ap.vendor", null, { subjectId: subj.id, groupId: (await one("ap.group", {})).id, postingProfileId: zam.id }, undefined, client);
    const emp = await saveRecord(T, "hr.employee", null, { personalNum: "001", firstName: "Václav", lastName: "Král", vendorId: vendor.id }, undefined, client);
    expect(emp.vendorId).toBe(String(vendor.id));

    // nahraný doklad (účtenka z obchodu), zaměstnanec ho chce proplatit
    const doc = await saveRecord(T, "int.document", null, { fileName: "uctenka.jpg", target: "apInvoice", docType: "receipt", partnerName: "Papírnictví", docNumber: "U-77", issueDate: "2026-11-20", currencyCode: "CZK", amountNet: "100", taxAmount: "21", amountGross: "121", employeeId: emp.id }, undefined, client);
    await saveRecord(T, "int.documentLine", null, { documentId: doc.id, description: "Papír A4", qty: "1", unitPrice: "100", taxRate: "21", amountNet: "100" }, undefined, client);
    await runAction(T, "int.document", String(doc.id), "check", client);
    await runAction(T, "int.document", String(doc.id), "list", client);
    const listed = (await getRecord(T, "int.document", String(doc.id), client))!;
    expect(listed.status).toBe("listed");

    // faktura na dodavatele zaměstnance s profilem ZAM, ne na obchod
    const [inv] = (await listRecords(T, "ap.invoice", { filter: { externalNum: "U-77" } }, client)).rows;
    expect([inv.vendorId, inv.postingProfileId]).toEqual([String(vendor.id), String(zam.id)]);
    // na dokladu jde profil změnit na standardní dodavatelský
    const changed = await saveRecord(T, "ap.invoice", String(inv.id), { ...inv, postingProfileId: std.id }, inv.version as number, client);
    expect(changed.postingProfileId).toBe(String(std.id));
  }, 180_000);
});
