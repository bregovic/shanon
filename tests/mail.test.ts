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

  it("Systémová pošta Shanonu: šablona organizace, HTML, odpovědi na firmu, příloha, příznak na účtence; testovací prostředí → uživateli", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
      if (String(url).includes("api.resend.com")) {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
        return new Response(JSON.stringify({ id: `re_${calls.length}` }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    const key = process.env.RESEND_API_KEY;
    const fromEnv = process.env.SHANON_MAIL_FROM;
    process.env.RESEND_API_KEY = "re_test";
    process.env.SHANON_MAIL_FROM = "Shanon <doklady@shanon.test>";
    try {
      const T = (await provisionTenant(client, { code: `t-mail2-${run}`, name: "MAIL2", adminEmail: `mail2-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "int", "org", "pos"], company: { code: "M", name: "Uzeniny Vzor" } })).ctx;
      // výchozí nastavení: napojení POSTA (Systémová pošta Shanonu) a šablona e-mailu v organizaci
      const [posta] = (await listRecords(T, "int.connection", { filter: { kind: "mail" } }, client)).rows;
      expect([posta.code, posta.driver, posta.active]).toEqual(["POSTA", "system", true]);
      const [org] = (await listRecords(T, "org.entity", {}, client)).rows;
      expect(String(org.mailInvoiceSubject)).toBe("Faktura {num} – {company}");
      await saveRecord(T, "org.entity", String(org.id), { legalName: "Uzeniny Vzor s.r.o.", email: "obchod@vzor.test", phone: "777 111 222", mailReceiptSubject: "Vaše účtenka {num} od {company}" }, undefined, client);

      const { sendDocumentNow } = await import("@/server/mail");
      const [reg] = (await listRecords(T, "pos.register", {}, client)).rows;
      const regId = reg ? String(reg.id) : String((await saveRecord(T, "pos.register", null, { code: "K1", name: "Kasa" }, undefined, client)).id);
      const g = (await listRecords(T, "inv.itemGroup", {}, client)).rows[0];
      const u = (await listRecords(T, "inv.unit", {}, client)).rows[0];
      const item = await saveRecord(T, "inv.item", null, { itemNum: "K", name: "Klobása", groupId: g.id, unitId: u.id, salesPrice: "50", priceInclTax: true }, undefined, client);
      await saveRecord(T, "pos.shift", null, { registerId: regId }, undefined, client);
      const { sell } = await import("@/modules/pos/sale");
      const { inTenant } = await import("@/server/data");
      const r = await inTenant(T, (s) => sell(s.sys().api(), { registerId: regId, payment: "cash", lines: [{ itemId: String(item.id), qty: "2" }] }), client);

      const res = await sendDocumentNow(T, "pos.receipt", String(r.id), "zakaznik@test.local", client);
      expect([res.test, res.to]).toEqual([false, ["zakaznik@test.local"]]);
      const b = calls.at(-1)!.body as { from: string; to: string[]; subject: string; reply_to: string; html: string; text: string; attachments: { filename: string; content: string }[] };
      // adresa odesílatele z proměnné serveru, jméno = firma
      expect(b.from).toBe("Uzeniny Vzor s.r.o. <doklady@shanon.test>");
      expect([b.to, b.reply_to, b.subject]).toEqual([["zakaznik@test.local"], "obchod@vzor.test", `Vaše účtenka ${r.receiptNum} od Uzeniny Vzor s.r.o.`]);
      expect(b.html).toContain("Uzeniny Vzor s.r.o.");
      expect(b.html).toContain("777 111 222");
      expect(b.text).toContain("děkujeme za váš nákup");
      expect(Buffer.from(b.attachments[0].content, "base64").subarray(0, 5).toString()).toBe("%PDF-");
      const rc = (await getRecord(T, "pos.receipt", String(r.id), client))!;
      expect([!!rc.emailedAt, rc.emailedTo]).toEqual([true, "zakaznik@test.local"]);

      // testovací prostředí: TEST-MAIL pošle zprávu přihlášenému uživateli, příjemce nic nedostane
      const { enableTestEnv } = await import("@/modules/int/test-env");
      await inTenant(T, (s) => enableTestEnv(s.sys().api(), (x) => x, false), client);
      const res2 = await sendDocumentNow(T, "pos.receipt", String(r.id), "zakaznik@test.local", client);
      expect([res2.test, res2.testTo]).toEqual([true, `mail2-${run}@test.local`]);
      const b2 = calls.at(-1)!.body as { to: string[]; subject: string; text: string };
      expect([b2.to, b2.subject.startsWith("[TEST] ")]).toEqual([[`mail2-${run}@test.local`], true]);
      expect(b2.text).toContain("zakaznik@test.local");
      expect(String((await getRecord(T, "pos.receipt", String(r.id), client))!.emailedTo)).toContain("test");
    } finally {
      if (key === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = key;
      if (fromEnv === undefined) delete process.env.SHANON_MAIL_FROM;
      else process.env.SHANON_MAIL_FROM = fromEnv;
      vi.unstubAllGlobals();
    }
  }, 120_000);
});
