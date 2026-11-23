/**
 * Odeslání dokladu e-mailem: akce „Odeslat e-mailem“ na vydané faktuře / záloze / účtence
 * založí koncept v Odeslané poště (příjemce z partnera, předmět a text ze šablony organizace
 * `org.entity.mail*` s proměnnými, PDF dokladu s vloženým ISDOC jako příloha) a otevře ho; „Odeslat“
 * ho pošle napojením pošty (HTML s hlavičkou firmy + text). Testovací prostředí (TEST-MAIL) pošle
 * zprávu přihlášenému uživateli. Odeslaný doklad dostane příznak (`emailedAt`, `emailedTo`).
 * Síť běží mimo transakci (`outside`).
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError, type ActionOutcome, type RecordData } from "@/core/module";
import { ADMIN } from "@/core/security";
import { writeLog } from "@/modules/int/drivers";
import { deliverMail, parseAddresses } from "@/modules/int/mail";
import { addFile, readFile } from "./docuref";
import { inTenant, type Ctx } from "./data";
import { printJob } from "./print";
import { documentMailHtml } from "./mail-templates";
import { fillMail, MAIL_DEFAULTS, MAIL_FIELDS, type MailDocKind } from "@/modules/org/mail-template";
import { registry } from "@/registry";
import { renderPdf } from "./print-pdf";
import { getT } from "./i18n";

const sysCtx = (ctx: Ctx): Ctx => ({ ...ctx, perms: ADMIN });

/** Aktivní napojení pošty: testovací (TEST-…) → vlastní server firmy → Systémová pošta Shanonu, pak podle kódu. */
const mailConnections = (list: RecordData[]) => {
  const rank = (c: RecordData) => (String(c.code).startsWith("TEST-") ? 0 : c.driver === "system" ? 2 : 1);
  return list.sort((a, b) => rank(a) - rank(b) || String(a.code).localeCompare(String(b.code)));
};

interface DraftSpec {
  objectId: "ar.invoice" | "ar.advance" | "pos.receipt";
  numField: string;
  amountField: string;
  dueField: string;
  subject: string;
  body: string;
}

async function draftFor(ctx: Ctx, id: string, spec: DraftSpec, client?: PrismaClient): Promise<ActionOutcome> {
  // (1) údaje dokladu a příjemce
  const prep = await inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      const t = s.sys().eventCtx(spec.objectId).t;
      const doc = await api.get(spec.objectId, id);
      if (!doc) throw new UserError("@SYS:NotFound");
      const partner = doc.customerId ? await api.get("ar.customer", String(doc.customerId)) : null;
      const subject = partner?.subjectId ? await api.get("gab.subject", String(partner.subjectId)) : null;
      const company = ctx.companyId ? await api.get("sys.company", ctx.companyId) : null;
      const org = (await api.find("org.entity", {}, { take: 1 }).catch(() => []))[0];
      const currency = doc.currencyId ? await api.get("sys.currency", String(doc.currencyId)) : null;
      const conn = mailConnections(await api.find("int.connection", { kind: "mail", active: true }, { take: 20 }))[0];
      const taxDoc = spec.objectId === "ar.advance" && !!doc.taxDocNum;
      const num = String(taxDoc ? doc.taxDocNum : doc[spec.numField] ?? "");
      const locale = ctx.lang === "en" ? "en-GB" : "cs-CZ";
      const params = {
        num,
        company: String(org?.tradeName || org?.legalName || company?.name || ""),
        amount: Number(doc[spec.amountField] ?? 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        currency: String(currency?.code ?? "CZK"),
        due: doc[spec.dueField] ? new Date(String(doc[spec.dueField])).toLocaleDateString(locale) : "",
        customer: String(subject?.name ?? doc.buyerName ?? ""),
      };
      // šablona organizace (prázdné pole = výchozí text); daňový doklad k záloze má vlastní text
      const kind: MailDocKind = spec.objectId === "ar.invoice" ? "invoice" : spec.objectId === "ar.advance" ? "advance" : "receipt";
      const tpl = (f: string, fallback: string) => fillMail(String(org?.[f] || fallback), params);
      // podpis: napojení pošty (kdo konkrétně posílá) → organizace → výchozí
      const signature = conn?.signature ? fillMail(String(conn.signature), params) : tpl("mailSignature", MAIL_DEFAULTS.signature);
      const text = taxDoc ? t("@INT:MailTaxDocBody", params) : tpl(MAIL_FIELDS[kind].body, MAIL_DEFAULTS[kind].body);
      const body = `${text}\n\n${signature}`;
      return {
        to: String(partner?.docEmail || subject?.email || ""),
        subject: taxDoc ? t("@INT:MailTaxDocSubject", params) : tpl(MAIL_FIELDS[kind].subject, MAIL_DEFAULTS[kind].subject),
        body,
        num,
        connectionId: conn?.id ?? null,
        label: `${t(spec.objectId === "ar.invoice" ? "@AR:Invoice" : spec.objectId === "pos.receipt" ? "@POS:Receipt" : taxDoc ? "@TAX:AdvanceTaxDoc" : "@AR:Advance")} ${num}`,
      };
    },
    client,
  );
  // (2) PDF dokladu (faktura s vloženým ISDOC)
  const job = await printJob(ctx, spec.objectId, id, null, client);
  const pdf = await renderPdf(job.layout, job.data, { locale: ctx.lang === "en" ? "en-GB" : "cs-CZ", title: job.title, attachments: job.attachments });
  // (3) koncept + příloha
  const mailId = await inTenant(
    ctx,
    async (s) => {
      const m = await s.sys().api().create("int.mail", {
        mailTo: prep.to || null,
        subject: prep.subject,
        body: prep.body,
        status: "draft",
        connectionId: prep.connectionId,
        reference: prep.label.slice(0, 250),
        sourceObject: spec.objectId,
        sourceId: id,
      } as RecordData);
      return String(m.id);
    },
    client,
  );
  await addFile(sysCtx(ctx), "int.mail", mailId, { name: `${(job.title || prep.num || "doklad").replace(/[^\w.-]+/g, "_")}.pdf`, type: "application/pdf", data: pdf }, client);
  return { open: { object: "int.mail", id: mailId } };
}

/**
 * Odeslat e-mailem (tlačítko u dokladu / v tisku): koncept s PDF a hned odeslat, když má příjemce
 * (e-mail odběratele). Bez příjemce nebo když odeslání selže → otevře se koncept k doplnění.
 */
async function draftThenSend(ctx: Ctx, draft: ActionOutcome, client?: PrismaClient): Promise<ActionOutcome> {
  const mailId = draft.open!.id;
  const m = await inTenant(ctx, (s) => s.sys().api().get("int.mail", mailId), client);
  if (!parseAddresses(m?.mailTo).length) return draft;
  const t = await getT(ctx.lang === "en" ? "en" : "cs", ctx.tenantId);
  try {
    const r = await sendMail(ctx, mailId, client);
    return { message: r.test ? t("@INT:MailTestSentTo", { to: r.testTo ?? "—" }) : t("@INT:MailSentTo", { to: r.to.join(", ") }) };
  } catch (e) {
    const reason = e instanceof UserError ? t(e.label, e.params) : e instanceof Error ? e.message : String(e);
    return { ...draft, message: t("@INT:MailNotSent", { reason }), warn: true };
  }
}

export const invoiceMailSend = async (ctx: Ctx, id: string, client?: PrismaClient) => draftThenSend(ctx, await invoiceMailDraft(ctx, id, client), client);
export const receiptMailSend = async (ctx: Ctx, id: string, client?: PrismaClient) => draftThenSend(ctx, await receiptMailDraft(ctx, id, client), client);
export const advanceMailSend = async (ctx: Ctx, id: string, client?: PrismaClient) => draftThenSend(ctx, await advanceMailDraft(ctx, id, client), client);

export const invoiceMailDraft = (ctx: Ctx, id: string, client?: PrismaClient) =>
  draftFor(ctx, id, { objectId: "ar.invoice", numField: "invoiceNum", amountField: "amountGross", dueField: "dueDate", subject: "@INT:MailInvoiceSubject", body: "@INT:MailInvoiceBody" }, client);

export const receiptMailDraft = (ctx: Ctx, id: string, client?: PrismaClient) =>
  draftFor(ctx, id, { objectId: "pos.receipt", numField: "receiptNum", amountField: "amountGross", dueField: "date", subject: "@INT:MailReceiptSubject", body: "@INT:MailReceiptBody" }, client);

/**
 * Odeslat doklad hned (pokladna): koncept s PDF jako „Odeslat e-mailem“, příjemce zadaný na pokladně,
 * pak odeslání napojením pošty. Bez napojení pošty zůstane koncept v Odeslané poště a vrátí se chyba.
 */
export async function sendDocumentNow(ctx: Ctx, objectId: "ar.invoice" | "pos.receipt", id: string, to: string, client?: PrismaClient): Promise<SentMail> {
  const draft = objectId === "ar.invoice" ? await invoiceMailDraft(ctx, id, client) : await receiptMailDraft(ctx, id, client);
  const mailId = draft.open!.id;
  await inTenant(ctx, (s) => s.sys().api().update("int.mail", mailId, { mailTo: to }), client);
  return sendMail(ctx, mailId, client);
}

/** Výsledek odeslání: komu šlo; testovací prostředí = šlo uživateli (`testTo`), ne příjemci. */
export interface SentMail {
  to: string[];
  test: boolean;
  testTo: string | null;
}

export const advanceMailDraft = (ctx: Ctx, id: string, client?: PrismaClient) =>
  draftFor(ctx, id, { objectId: "ar.advance", numField: "advanceNum", amountField: "amount", dueField: "dueDate", subject: "@INT:MailAdvanceSubject", body: "@INT:MailAdvanceBody" }, client);

/** Odeslat koncept napojením pošty (z e-mailu, jinak první aktivní). */
export async function sendMail(ctx: Ctx, id: string, client?: PrismaClient): Promise<SentMail> {
  const prep = await inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      const m = await api.get("int.mail", id);
      if (!m) throw new UserError("@SYS:NotFound");
      if (m.status === "sent") throw new UserError("@SYS:Locked");
      const conns = mailConnections(await api.find("int.connection", { kind: "mail", active: true }, { take: 20 }));
      // testovací prostředí má přednost i před napojením uloženým v konceptu (ostré je pozastavené)
      const conn = conns.find((c) => String(c.code).startsWith("TEST-")) ?? conns.find((c) => c.id === m.connectionId) ?? conns[0];
      if (!conn) throw new UserError("@INT:MailNoConnection");
      const to = parseAddresses(m.mailTo);
      if (!to.length) throw new UserError("@INT:MailNoRecipient");
      const cc = parseAddresses(m.mailCc);
      const refs = await s.tx.sysDocuRef.findMany({ where: { tenantId: ctx.tenantId, objectId: "int.mail", recordId: id, kind: "file" }, orderBy: { createdAt: "asc" } });
      // vzhled e-mailu: hlavička s firmou, kontakty organizace, odpovědi na e-mail organizace
      const org = (await api.find("org.entity", {}, { take: 1 }).catch(() => []))[0];
      const company = ctx.companyId ? await api.get("sys.company", ctx.companyId) : null;
      const name = String(org?.tradeName || org?.legalName || company?.name || "");
      const addr = org ? [[org.street, [org.houseNo, org.orientNo].filter(Boolean).join("/")].filter(Boolean).join(" "), [org.zipCode, org.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
      const t = s.sys().eventCtx("int.mail").t;
      const html = documentMailHtml({ company: name, text: String(m.body ?? ""), contacts: [addr, org?.phone as string, org?.email as string, org?.web as string].filter(Boolean) as string[], note: t("@INT:MailFooterNote", { company: name }) });
      // testovací prostředí: zprávu dostane přihlášený uživatel
      const me = conn.driver === "mailTest" ? await s.tx.sysUser.findFirst({ where: { id: ctx.userId, tenantId: ctx.tenantId }, select: { email: true } }) : null;
      return { m, conn, to, cc, refs: refs.map((r) => r.id), html, fromName: name, replyTo: (org?.email as string) || null, testTo: me?.email ?? null, testNote: t("@INT:MailTestFor", { to: to.join(", ") }) };
    },
    client,
  );
  const attachments = [];
  for (const ref of prep.refs) {
    const f = await readFile(sysCtx(ctx), ref, client);
    attachments.push({ filename: f.name, content: f.data, contentType: f.mime });
  }
  const { m, conn } = prep;
  try {
    // napojení bez vlastního jména odesílatele: název firmy
    const c = { ...conn, fromName: conn.fromName || prep.fromName };
    const messageId = await deliverMail(c, { to: prep.to, cc: prep.cc, subject: String(m.subject), text: String(m.body ?? ""), html: prep.html, attachments }, { testTo: prep.testTo, replyTo: prep.replyTo, testNote: prep.testNote });
    const test = conn.driver === "mailTest";
    await inTenant(
      ctx,
      async (s) => {
        const api = s.sys().api();
        const t = s.sys().eventCtx("int.mail").t;
        const now = new Date().toISOString();
        await api.update("int.mail", id, { status: "sent", sentAt: now, messageId: messageId.slice(0, 250), connectionId: conn.id, error: null });
        await writeLog(api, conn, "mail.send", "ok", {
          reference: String(m.reference ?? m.subject).slice(0, 250),
          externalId: messageId.slice(0, 250),
          message: `${prep.to.join(", ")}`.slice(0, 250),
          detail: test ? `${prep.testTo ? t("@INT:MailTestSentTo", { to: prep.testTo }) : t("@INT:MailTestSent")}\n\n${m.subject}\n\n${m.body ?? ""}` : null,
        });
        // příznak na dokladu: kdy a komu; testovací prostředí poctivě — komu zpráva skutečně šla
        const src = m.sourceObject ? registry.objects.get(String(m.sourceObject)) : null;
        const sentTo = test ? t("@INT:MailTestFlag", { user: prep.testTo ?? "—", to: prep.to.join(", ") }) : prep.to.join(", ");
        if (src && m.sourceId && "emailedAt" in src.fields)
          await api.update(src.id, String(m.sourceId), { emailedAt: now, ...("emailedTo" in src.fields ? { emailedTo: sentTo.slice(0, 254) } : {}) });
      },
      client,
    );
    return { to: prep.to, test, testTo: test ? prep.testTo : null };
  } catch (e) {
    const reason = e instanceof UserError ? null : e instanceof Error ? e.message : String(e);
    await inTenant(
      ctx,
      async (s) => {
        const api = s.sys().api();
        const t = s.sys().eventCtx("int.mail").t;
        const msg = e instanceof UserError ? t(e.label, e.params) : t("@INT:MailFailed", { reason: reason ?? "" });
        await api.update("int.mail", id, { error: msg.slice(0, 250), connectionId: conn.id });
        await writeLog(api, conn, "mail.send", "error", { reference: String(m.reference ?? m.subject).slice(0, 250), message: msg.slice(0, 250) });
      },
      client,
    );
    if (e instanceof UserError) throw e;
    throw new UserError("@INT:MailFailed", { reason: reason ?? "" });
  }
}
