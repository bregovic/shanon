/**
 * Odeslání dokladu e-mailem: akce „Odeslat e-mailem“ na vydané faktuře / záloze
 * založí koncept v Odeslané poště (příjemce z partnera, text v jazyce uživatele,
 * PDF dokladu s vloženým ISDOC jako příloha) a otevře ho; „Odeslat“ ho pošle
 * napojením pošty. Síť běží mimo transakci (`outside`).
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError, type ActionOutcome, type RecordData } from "@/core/module";
import { ADMIN } from "@/core/security";
import { writeLog } from "@/modules/int/drivers";
import { deliverMail, parseAddresses } from "@/modules/int/mail";
import { addFile, readFile } from "./docuref";
import { inTenant, type Ctx } from "./data";
import { printJob } from "./print";
import { renderPdf } from "./print-pdf";

const sysCtx = (ctx: Ctx): Ctx => ({ ...ctx, perms: ADMIN });

interface DraftSpec {
  objectId: "ar.invoice" | "ar.advance";
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
      const conn = (await api.find("int.connection", { kind: "mail", active: true }, { take: 20 })).sort((a, b) => String(a.code).localeCompare(String(b.code)))[0];
      const taxDoc = spec.objectId === "ar.advance" && !!doc.taxDocNum;
      const num = String(taxDoc ? doc.taxDocNum : doc[spec.numField] ?? "");
      const locale = ctx.lang === "en" ? "en-GB" : "cs-CZ";
      const params = {
        num,
        company: String(org?.legalName ?? company?.name ?? ""),
        amount: Number(doc[spec.amountField] ?? 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        currency: String(currency?.code ?? ""),
        due: doc[spec.dueField] ? new Date(String(doc[spec.dueField])).toLocaleDateString(locale) : "",
      };
      const body = t(taxDoc ? "@INT:MailTaxDocBody" : spec.body, params) + (conn?.signature ? `\n\n${conn.signature}` : "");
      return {
        to: String(partner?.docEmail || subject?.email || ""),
        subject: t(taxDoc ? "@INT:MailTaxDocSubject" : spec.subject, params),
        body,
        num,
        connectionId: conn?.id ?? null,
        label: `${t(spec.objectId === "ar.invoice" ? "@AR:Invoice" : taxDoc ? "@TAX:AdvanceTaxDoc" : "@AR:Advance")} ${num}`,
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

export const invoiceMailDraft = (ctx: Ctx, id: string, client?: PrismaClient) =>
  draftFor(ctx, id, { objectId: "ar.invoice", numField: "invoiceNum", amountField: "amountGross", dueField: "dueDate", subject: "@INT:MailInvoiceSubject", body: "@INT:MailInvoiceBody" }, client);

export const advanceMailDraft = (ctx: Ctx, id: string, client?: PrismaClient) =>
  draftFor(ctx, id, { objectId: "ar.advance", numField: "advanceNum", amountField: "amount", dueField: "dueDate", subject: "@INT:MailAdvanceSubject", body: "@INT:MailAdvanceBody" }, client);

/** Odeslat koncept napojením pošty (z e-mailu, jinak první aktivní). */
export async function sendMail(ctx: Ctx, id: string, client?: PrismaClient): Promise<void> {
  const prep = await inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      const m = await api.get("int.mail", id);
      if (!m) throw new UserError("@SYS:NotFound");
      if (m.status === "sent") throw new UserError("@SYS:Locked");
      const conns = (await api.find("int.connection", { kind: "mail", active: true }, { take: 20 })).sort((a, b) => String(a.code).localeCompare(String(b.code)));
      const conn = conns.find((c) => c.id === m.connectionId) ?? conns[0];
      if (!conn) throw new UserError("@INT:MailNoConnection");
      const to = parseAddresses(m.mailTo);
      if (!to.length) throw new UserError("@INT:MailNoRecipient");
      const cc = parseAddresses(m.mailCc);
      const refs = await s.tx.sysDocuRef.findMany({ where: { tenantId: ctx.tenantId, objectId: "int.mail", recordId: id, kind: "file" }, orderBy: { createdAt: "asc" } });
      return { m, conn, to, cc, refs: refs.map((r) => r.id) };
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
    const messageId = await deliverMail(conn, { to: prep.to, cc: prep.cc, subject: String(m.subject), text: String(m.body ?? ""), attachments });
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
          detail: conn.driver === "mailTest" ? `${t("@INT:MailTestSent")}\n\n${m.subject}\n\n${m.body ?? ""}` : null,
        });
        if (m.sourceObject === "ar.invoice" && m.sourceId) await api.update("ar.invoice", String(m.sourceId), { emailedAt: now });
      },
      client,
    );
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
