/**
 * Pošta: napojení druhu „mail“ — ovladač SMTP (nodemailer) nebo testovací
 * schránka (`mailTest`, nic neodesílá, zpráva jen do protokolu).
 */
import nodemailer from "nodemailer";
import { UserError, type RecordData } from "@/core/module";
import { revealSecret } from "@/server/secrets";

const ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** „a@b.cz; c@d.cz, …“ → seznam adres; neplatná adresa = chyba s adresou. */
export function parseAddresses(v: unknown): string[] {
  const list = String(v ?? "")
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  for (const a of list) if (!ADDRESS.test(a)) throw new UserError("@INT:MailBadAddress", { address: a });
  return list;
}

export interface OutgoingMail {
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  attachments: { filename: string; content: Buffer; contentType: string }[];
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

/** Odeslat zprávu; vrací id zprávy (u testovací schránky vymyšlené). */
export async function deliverMail(conn: RecordData, m: OutgoingMail): Promise<string> {
  const from = sender(conn);
  if (conn.driver === "mailTest") return `test-${Date.now()}@shanon.local`;
  const info = await transport(conn).sendMail({
    from,
    to: m.to,
    cc: m.cc.length ? m.cc : undefined,
    bcc: conn.bccSelf ? String(conn.fromEmail) : undefined,
    replyTo: conn.replyTo ? String(conn.replyTo) : undefined,
    subject: m.subject,
    text: m.text,
    attachments: m.attachments,
  });
  return String(info.messageId ?? "");
}

/** Test napojení: přihlášení k serveru (bez odeslání zprávy). */
export async function verifyMail(conn: RecordData): Promise<void> {
  sender(conn);
  if (conn.driver === "mailTest") return;
  await transport(conn).verify();
}
