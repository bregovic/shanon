/**
 * Aplikace Portál: zaměstnanec (pozvánka → heslo → přihlášení osobním číslem, zámek po chybách, firmy podle karet),
 * dodavatel (odkaz jen pro e-mail z Kontaktů portálu, neznámý e-mail nic nedostane, odkaz platí jednou),
 * podání: účtenka zaměstnance → doklad ke zpracování (zdroj app) → zalistování na dodavatele zaměstnance s profilem ZAM.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// cookie a systémová pošta mimo Next.js: vlastní úložiště cookie, zachycené e-maily
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => new Headers(),
}));
const mails: { to: string; subject: string; text: string }[] = [];
vi.mock("@/server/system-mail", async (orig) => ({
  ...(await orig<typeof import("@/server/system-mail")>()),
  sendSystemMail: async (m: { to: string; subject: string; text: string }) => {
    mails.push(m);
    return true;
  },
}));

import { createPrisma } from "@/server/db";
import { getRecord, inTenant, listRecords, runAction, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { consumeVendorLink, employeeByToken, employeeLogin, portalIdentity, requestVendorLink, setEmployeePassword } from "@/server/portal-auth";
import { portalAgendas, portalAppSubmit } from "@/server/portal-app";
import { applyExtraction } from "@/modules/int/documents";
import type { OcrResult } from "@/modules/int/ocr";
import { fireWorkflowEvent } from "@/server/workflow";

const client = createPrisma();
const run = Date.now().toString(36);
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");
const linkOf = (text: string) => /https?:\/\/\S+\?t=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";

describe("aplikace Portál", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("zaměstnanec: pozvánka, heslo, přihlášení, firmy, účtenka → dodavatel zaměstnance (ZAM)", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 })); // registr / vytěžení mimo test
    const code = `t-pa-${run}`;
    const T = (await provisionTenant(client, { code, name: "PortálApp", adminEmail: `pa-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap", "int", "hr"], company: { code: "A", name: "Alfa s.r.o." } })).ctx;
    // portál firmy pro aplikaci (zaměstnanci zapnutí)
    await saveRecord(T, "int.portal", null, { name: "Portál", appEmployees: true }, undefined, client);
    const emp = await saveRecord(T, "hr.employee", null, { personalNum: "e-007", firstName: "Eva", lastName: "Malá", email: `eva-${run}@test.local` }, undefined, client);
    expect([emp.personalNum, emp.name]).toEqual(["E-007", "Eva Malá"]);

    // pozvánka (akce mimo transakci) → e-mail s odkazem na nastavení hesla
    await runAction(T, "hr.employee", String(emp.id), "invite", client);
    const inv = mails.pop()!;
    expect(inv.to).toBe(`eva-${run}@test.local`);
    expect(inv.text).toContain("E-007");
    const token = linkOf(inv.text);
    expect(await employeeByToken(code, token, client)).toBe("E-007");
    expect((await getRecord(T, "hr.employee", String(emp.id), client))!.portalInvitedAt).toBeTruthy();

    // krátké heslo nejde; nastavení heslo přihlásí, odkaz pak neplatí
    await expect(setEmployeePassword(code, token, "123", client)).rejects.toMatchObject({ label: "@INT:AppPasswordShort" });
    await setEmployeePassword(code, token, "heslo-eva-1", client);
    expect(await employeeByToken(code, token, client)).toBeNull();
    const id = (await portalIdentity(code, client))!;
    expect([id.kind, id.login, id.name, id.companies.map((c) => c.companyName)]).toEqual(["employee", "E-007", "Eva Malá", ["Alfa s.r.o."]]);

    // přihlášení: špatné heslo → obecná hláška, 5× → zámek; správné po odemčení projde
    jar.clear();
    await expect(employeeLogin(code, "e-007", "spatne", "1.1.1.1", client)).rejects.toMatchObject({ label: "@INT:AppLoginFailed" });
    await expect(employeeLogin(code, "neexistuje", "x", "1.1.1.1", client)).rejects.toMatchObject({ label: "@INT:AppLoginFailed" });
    await employeeLogin(code, "e-007", "heslo-eva-1", "1.1.1.1", client);
    expect((await portalIdentity(code, client))?.login).toBe("E-007");
    for (let i = 0; i < 5; i++) await employeeLogin(code, "e-007", "spatne", "1.1.1.2", client).catch(() => undefined);
    await expect(employeeLogin(code, "e-007", "heslo-eva-1", "1.1.1.2", client)).rejects.toMatchObject({ label: "@INT:AppLocked" });
    await client.sysPortalAccount.updateMany({ where: { tenantId: T.tenantId, login: "E-007" }, data: { lockedUntil: null, failedLogins: 0 } });

    // bez přístupu (vypnutý přístup na kartě) → žádná firma, identita neplatí
    await saveRecord(T, "hr.employee", String(emp.id), { portalAccess: false }, undefined, client);
    expect(await portalIdentity(code, client)).toBeNull();
    await saveRecord(T, "hr.employee", String(emp.id), { portalAccess: true }, undefined, client);

    // agendy zaměstnance a podání účtenky
    const me = (await portalIdentity(code, client))!;
    const ag = (await portalAgendas(me, T.companyId!, client))!;
    expect(ag.agendas.map((a) => a.id)).toEqual(["receipt", "companyDoc"]);
    expect((await portalAppSubmit(me, { companyId: T.companyId!, agenda: "invoice", note: "", files: [{ name: "u.pdf", type: "application/pdf", data: pdf }] }, client)).ok).toBe(false);
    const res = await portalAppSubmit(me, { companyId: T.companyId!, agenda: "receipt", note: "Parkování", files: [{ name: "uctenka.pdf", type: "application/pdf", data: pdf }] }, client);
    expect(res.ok).toBe(true);
    const [doc] = (await listRecords(T, "int.document", { filter: { source: "app" } }, client)).rows;
    expect([doc.employeeId, doc.senderName, doc.senderNote, doc.target]).toEqual([emp.id, "Eva Malá", "Parkování", "apInvoice"]);

    // vytěžená účtenka z obchodu → zalistuje se na dodavatele zaměstnance s profilem ZAM, ne na obchod
    const receipt = {
      docType: "receipt", confidence: "high", uncertainFields: [],
      issuer: { name: "Parkoviště Centrum", regNo: "12345678", vatId: null, street: null, city: null, zip: null, country: "CZ", bankAccount: null, iban: null },
      recipient: { name: null, regNo: null, vatId: null, street: null, city: null, zip: null, country: null, bankAccount: null, iban: null },
      docNumber: "P-991", orderNumber: null, issueDate: "2026-11-19", taxDate: "2026-11-19", dueDate: null, vs: null, currency: "CZK",
      amountNet: 100, taxAmount: 21, amountGross: 121, lines: [], note: null,
    } as unknown as OcrResult;
    await inTenant(T, async (s) => {
      const api = s.sys().api();
      await applyExtraction(api, (await api.get("int.document", String(doc.id)))!, receipt, await api.get("sys.company", T.companyId!), s.sys().eventCtx("int.document").t);
      await fireWorkflowEvent(s.sys(), "int.document", String(doc.id), "extracted");
    }, client);
    const listed = (await getRecord(T, "int.document", String(doc.id), client))!;
    expect([listed.status, listed.resultObject]).toEqual(["listed", "ap.invoice"]);
    const apInv = (await getRecord(T, "ap.invoice", String(listed.resultId), client))!;
    const empNow = (await getRecord(T, "hr.employee", String(emp.id), client))!;
    expect(apInv.vendorId).toBe(empNow.vendorId);
    const vendor = (await getRecord(T, "ap.vendor", String(empNow.vendorId), client))!;
    const [zam] = (await listRecords(T, "ap.postingProfile", { filter: { code: "ZAM" } }, client)).rows;
    expect(vendor.postingProfileId).toBe(zam.id);
    expect([apInv.docType, apInv.externalNum, apInv.description]).toEqual(["receipt", "P-991", "Parkoviště Centrum"]);
  }, 180_000);

  it("dodavatel: odkaz jen pro známý e-mail, jen jeho firmy, odkaz platí jednou", async () => {
    jar.clear();
    mails.length = 0;
    const code = `t-pv-${run}`;
    const { ctx: T } = await provisionTenant(client, { code, name: "PortálDod", adminEmail: `pv-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap", "int"], company: { code: "A", name: "Alfa s.r.o." } });
    // druhá firma bez kontaktu
    const b = await saveRecord(T, "sys.company", null, { code: "B", name: "Beta s.r.o." }, undefined, client);
    const B: Ctx = { ...T, companyId: String(b.id) };
    await saveRecord(T, "int.portal", null, { name: "Portál" }, undefined, client);
    await saveRecord(B, "int.portal", null, { name: "Portál B" }, undefined, client);
    const mail = `fakturace-${run}@dodavatel.test`;
    const contact = await saveRecord(T, "int.portalContact", null, { email: mail, name: "Dodavatel a.s." }, undefined, client);

    // neznámý e-mail: odpověď stejná (true), e-mail nepřijde
    expect(await requestVendorLink(code, `cizi-${run}@nekdo.test`, "2.2.2.2", client)).toBe(true);
    expect(mails.length).toBe(0);
    expect(await requestVendorLink(code, "neni-email", "2.2.2.2", client)).toBe(false);

    // pozvánka z karty kontaktu → odkaz rovnou přihlásí
    await runAction(T, "int.portalContact", String(contact.id), "invite", client);
    const inv = mails.pop()!;
    expect(inv.to).toBe(mail);
    expect(await consumeVendorLink(code, linkOf(inv.text), client)).toBe(true);
    const id = (await portalIdentity(code, client))!;
    expect([id.kind, id.companies.map((c) => c.companyName)]).toEqual(["vendor", ["Alfa s.r.o."]]);
    expect((await portalAgendas(id, T.companyId!, client))!.agendas.map((a) => a.id)).toEqual(["invoice", "advance", "order", "other"]);
    // cizí firma (Beta) nejde
    expect((await portalAppSubmit(id, { companyId: String(b.id), agenda: "invoice", note: "", files: [{ name: "f.pdf", type: "application/pdf", data: pdf }] }, client)).ok).toBe(false);

    // přihlašovací odkaz platí jednou
    jar.clear();
    expect(await requestVendorLink(code, mail.toUpperCase(), "2.2.2.3", client)).toBe(true);
    const link = linkOf(mails.pop()!.text);
    expect(await consumeVendorLink(code, link, client)).toBe(true);
    expect(await consumeVendorLink(code, link, client)).toBe(false);

    // vypnutý kontakt = konec přístupu
    await saveRecord(T, "int.portalContact", String(contact.id), { active: false }, undefined, client);
    expect(await portalIdentity(code, client)).toBeNull();
  }, 180_000);
});
