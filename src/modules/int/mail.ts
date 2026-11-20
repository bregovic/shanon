/**
 * Pošta: napojení druhu „mail“ — ovladače:
 * - `system` Systémová pošta Shanonu: přes platformu (Resend), odesílá adresa platformy se jménem firmy,
 *   odpovědi na e-mail firmy (Railway odchozí SMTP blokuje, tohle funguje vždy);
 * - `smtp` vlastní poštovní server (nodemailer) — jen mimo Railway / s povoleným SMTP;
 * - `mailTest` testovací prostředí: zprávu pošle přihlášenému uživateli místo příjemce (s poznámkou,
 *   komu byla určena), bez uživatele jen do protokolu.
 */
import nodemailer from "nodemailer";
import { isEmail } from "@/core/edt";
import { UserError, type RecordData } from "@/core/module";
import { revealSecret } from "@/server/secrets";
import { sendPlatformMail, systemMailConfigured } from "@/server/system-mail";


/** „a@b.cz; c@d.cz, …“ → seznam adres; neplatná adresa = chyba s adresou. */
export function parseAddresses(v: unknown): string[] {
  const list = String(v ?? "")
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  for (const a of list) if (!isEmail(a)) throw new UserError("@INT:MailBadAddress", { address: a });
  return list;
}

export interface OutgoingMail {
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html?: string;
  attachments: { filename: string; content: Buffer; contentType: string }[];
}

export interface DeliverOptions {
  /** testovací prostředí: skutečný příjemce = tento e-mail (přihlášený uživatel) */
  testTo?: string | null;
  /** odpovědi, když napojení nemá vlastní (e-mail organizace) */
  replyTo?: string | null;
  /** text poznámky pro testovací zprávu (v jazyce uživatele) */
  testNote?: string;
}

function transport(conn: RecordData) {
  if (!conn.smtpHost) throw new UserError("@INT:MailNoHost");
  const tls = conn.smtpSecurity === "tls";
  const user = String(conn.smtpUser ?? "");
  return nodemailer.createTransport({
    host: String(conn.smtpHost),
    port: Number(conn.smtpPort || (tls ? 465 : 587)),
    secure: tls,
    requireTLS: !tls,
    auth: user ? { user, pass: revealSecret(conn.smtpPassword) ?? "" } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

const sender = (conn: RecordData) => {
  if (!conn.fromEmail) throw new UserError("@INT:MailNoFrom");
  return conn.fromName ? { name: String(conn.fromName), address: String(conn.fromEmail) } : String(conn.fromEmail);
};

/** Odeslat zprávu; vrací id zprávy (u testovací schránky bez uživatele vymyšlené). */
export async function deliverMail(conn: RecordData, m: OutgoingMail, o: DeliverOptions = {}): Promise<string> {
  const replyTo = (conn.replyTo as string) || o.replyTo || undefined;
  if (conn.driver === "system")
    return sendPlatformMail({ to: m.to, cc: m.cc, subject: m.subject, text: m.text, html: m.html, fromName: (conn.fromName as string) || undefined, replyTo, attachments: m.attachments });
  if (conn.driver === "mailTest") {
    if (!o.testTo || !systemMailConfigured()) return `test-${Date.now()}@shanon.local`;
    const note = o.testNote ?? `Testovací prostředí — zpráva byla určena pro: ${m.to.join(", ")}`;
    return sendPlatformMail({
      to: [o.testTo],
      subject: `[TEST] ${m.subject}`,
      text: `${note}\n\n${m.text}`,
      html: m.html ? `<p style="background:#fff4ce;padding:8px 12px;border-radius:6px;font-family:Segoe UI,Arial,sans-serif;font-size:13px">${note.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>${m.html}` : undefined,
      fromName: (conn.fromName as string) || undefined,
      replyTo,
      attachments: m.attachments,
    });
  }
  const from = sender(conn);
  const info = await transport(conn).sendMail({
    from,
    to: m.to,
    cc: m.cc.length ? m.cc : undefined,
    bcc: conn.bccSelf ? String(conn.fromEmail) : undefined,
    replyTo,
    subject: m.subject,
    text: m.text,
    html: m.html,
    attachments: m.attachments,
  });
  return String(info.messageId ?? "");
}

/** Test napojení: přihlášení k serveru (bez odeslání zprávy). */
export async function verifyMail(conn: RecordData): Promise<void> {
  if (conn.driver === "system") {
    if (!systemMailConfigured()) throw new UserError("@INT:MailSystemOff");
    return;
  }
  sender(conn);
  if (conn.driver === "mailTest") return;
  await transport(conn).verify();
}
