/**
 * Pošta: faktura → Odeslat e-mailem (koncept s PDF a ISDOC, příjemce z partnera)
 * → Odeslat testovací schránkou i SMTP (nodemailer nahrazený záznamem zpráv).
 */
import { describe, expect, it, vi } from "vitest";

const sent: Record<string, unknown>[] = [];
const transports: Record<string, unknown>[] = [];
vi.mock("nodemailer", () => ({
  default: {
    createTransport: (opts: Record<string, unknown>) => {
      transports.push(opts);
      return {
        sendMail: async (m: Record<string, unknown>) => (sent.push(m), { messageId: "<m1@smtp.test>" }),
        verify: async () => true,
      };
    },
  },
}));

import { createPrisma } from "@/server/db";
import { getRecord, listRecords, runAction, saveRecord } from "@/server/data";
import { listDocuRefs } from "@/server/docuref";
import { provisionTenant } from "@/server/provision";
import { isdocFromFile } from "@/modules/prt/isdoc";
import { parseAddresses } from "@/modules/int/mail";

const client = createPrisma();
const run = Date.now().toString(36);

describe("pošta", () => {
  it("adresy: čárka, středník, mezery; neplatná = chyba", () => {
    expect(parseAddresses(" a@b.cz; c@d.eu,e@f.com ")).toEqual(["a@b.cz", "c@d.eu", "e@f.com"]);
    expect(() => parseAddresses("a@b.cz, spatne")).toThrow();
  });

  it("faktura e-mailem: koncept s PDF (ISDOC), testovací schránka, SMTP", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
    const T = (await provisionTenant(client, { code: `t-mail-${run}`, name: "MAIL", adminEmail: `mail-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "int", "org"], company: { code: "M", name: "Uzeniny Vzor" } })).ctx;
    const [org] = (await listRecords(T, "org.entity", {}, client)).rows;
    await saveRecord(T, "org.entity", String(org.id), { legalName: "Uzeniny Vzor s.r.o.", bankAccount: "123456789/0100" }, undefined, client);
    const subj = await saveRecord(T, "gab.subject", null, { name: "Restaurace U Lípy", email: "info@ulipy.test" }, undefined, client);
    const [grp] = (await listRecords(T, "ar.group", {}, client)).rows;
    const cust = await saveRecord(T, "ar.customer", null, { subjectId: subj.id, groupId: grp.id, docEmail: "faktury@ulipy.test" }, undefined, client);
    const inv = await saveRecord(T, "ar.invoice", null, { customerId: cust.id, invoiceDate: "2026-11-14", dueDate: "2026-11-28" }, undefined, client);
    await saveRecord(T, "ar.invoiceLine", null, { invoiceId: inv.id, description: "Klobása", qty: "2", unitPrice: "100" }, undefined, client);
    await runAction(T, "ar.invoice", String(inv.id), "post", client);

    // bez napojení pošty koncept vznikne, odeslat nejde
    const test = await saveRecord(T, "int.connection", null, { code: "TEST-MAIL", name: "Test", kind: "mail", driver: "mailTest", fromEmail: "fakturace@vzor.test", signature: "Jan Novák, tel. 777 000 000" }, undefined, client);
    const out = await runAction(T, "ar.invoice", String(inv.id), "email", client);
    expect(out?.open?.object).toBe("int.mail");
    const id = out!.open!.id;
    const draft = (await getRecord(T, "int.mail", id, client))!;
    expect([draft.mailTo, draft.status, draft.connectionId, draft.sourceObject]).toEqual(["faktury@ulipy.test", "draft", test.id, "ar.invoice"]);
    expect(draft.subject).toBe(`Faktura ${inv.invoiceNum} – Uzeniny Vzor s.r.o.`);
    expect(String(draft.body)).toContain("na částku 242,00 CZK se splatností 28. 11. 2026");
    expect(String(draft.body)).toContain("Jan Novák, tel. 777 000 000");
    const files = await listDocuRefs(T, "int.mail", id, client);
    expect(files.map((f) => f.name)).toEqual([expect.stringMatching(/\.pdf$/)]);

    // testovací schránka: odesláno, nic přes SMTP, faktura s datem odeslání, protokol
    await runAction(T, "int.mail", id, "send", client);
    const done = (await getRecord(T, "int.mail", id, client))!;
    expect([done.status, !!done.sentAt, done.error]).toEqual(["sent", true, null]);
    expect(sent.length).toBe(0);
    expect((await getRecord(T, "ar.invoice", String(inv.id), client))!.emailedAt).toBeTruthy();
    const [log] = (await listRecords(T, "int.log", { filter: { operation: "mail.send" } }, client)).rows;
    expect([log.status, log.message]).toEqual(["ok", "faktury@ulipy.test"]);
    await expect(runAction(T, "int.mail", id, "send", client)).rejects.toThrow();
    await expect(saveRecord(T, "int.mail", id, { subject: "jiný" }, undefined, client)).rejects.toThrow();

    // SMTP: heslo dešifrované, příloha PDF s ISDOC, kopie odesílateli
    await saveRecord(T, "int.connection", String(test.id), { active: false }, undefined, client);
    const smtp = await saveRecord(T, "int.connection", null, { code: "SMTP", name: "Pošta", kind: "mail", driver: "smtp", smtpHost: "smtp.vzor.test", smtpPort: 465, smtpSecurity: "tls", smtpUser: "fakturace", smtpPassword: "tajne-heslo", fromEmail: "fakturace@vzor.test", fromName: "Uzeniny Vzor", bccSelf: true }, undefined, client);
    await runAction(T, "int.connection", String(smtp.id), "test", client);
    const out2 = await runAction(T, "ar.invoice", String(inv.id), "email", client);
    await saveRecord(T, "int.mail", out2!.open!.id, { mailTo: "a@ulipy.test; b@ulipy.test", mailCc: "c@ulipy.test" }, undefined, client);
    await runAction(T, "int.mail", out2!.open!.id, "send", client);
    expect(transports.at(-1)).toMatchObject({ host: "smtp.vzor.test", port: 465, secure: true, auth: { user: "fakturace", pass: "tajne-heslo" } });
    const m = sent[0] as { from: unknown; to: string[]; cc: string[]; bcc: string; attachments: { filename: string; content: Buffer }[] };
    expect([m.from, m.to, m.cc, m.bcc]).toEqual([{ name: "Uzeniny Vzor", address: "fakturace@vzor.test" }, ["a@ulipy.test", "b@ulipy.test"], ["c@ulipy.test"], "fakturace@vzor.test"]);
    expect(isdocFromFile(m.attachments[0].filename, m.attachments[0].content)).toBeTruthy();
    expect((await getRecord(T, "int.mail", out2!.open!.id, client))!.messageId).toBe("<m1@smtp.test>");

    // chyba adresy: zůstane koncept s chybou
    const out3 = await runAction(T, "ar.invoice", String(inv.id), "email", client);
    await saveRecord(T, "int.mail", out3!.open!.id, { mailTo: "spatna-adresa" }, undefined, client);
    await expect(runAction(T, "int.mail", out3!.open!.id, "send", client)).rejects.toThrow();
    expect((await getRecord(T, "int.mail", out3!.open!.id, client))!.status).toBe("draft");
    vi.unstubAllGlobals();
  }, 120_000);
});
