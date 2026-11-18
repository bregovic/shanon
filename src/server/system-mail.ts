/**
 * Systémová pošta aplikace (pozvánky, reset hesla, „nemůžu se přihlásit“) — nezávislá na firmě a jejím
 * napojení pošty v Integraci. Nastavení jen z prostředí, nikdy z databáze ani z repa:
 *
 *   RESEND_API_KEY — odesílání přes Resend (HTTPS). Na Railway jediná cesta: odchozí SMTP Railway blokuje.
 *   SHANON_MAIL_FROM — odesílatel, např. „Shanon <shanon@hollyhop.cz>“ (doména musí být ověřená v Resendu)
 *   SHANON_SMTP_HOST, _PORT (587 STARTTLS / 465 TLS), _USER, _PASS — místo Resendu, jen na vlastním hostingu
 *   SHANON_SUPPORT_EMAIL — kam chodí „Nemůžu se přihlásit“ (výchozí = odesílatel)
 *   SHANON_PROD_URL, SHANON_TEST_URL — adresy prostředí do pozvánky
 *
 * Bez Resendu i SMTP se nic neodesílá: zpráva se jen vypíše do logu serveru (vývoj, testy).
 */
import nodemailer from "nodemailer";

export interface SystemMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

export const systemMailConfigured = () => !!process.env.RESEND_API_KEY || !!process.env.SHANON_SMTP_HOST;

/** „Jméno <adresa>“ odesílatele */
function from(): string {
  if (process.env.SHANON_MAIL_FROM) return process.env.SHANON_MAIL_FROM;
  const address = process.env.SHANON_SMTP_FROM || process.env.SHANON_SMTP_USER || "shanon@hollyhop.cz";
  return `${process.env.SHANON_SMTP_FROM_NAME || "Shanon"} <${address}>`;
}

const fromAddress = () => from().replace(/^.*<([^>]+)>.*$/, "$1");

export const supportEmail = () => process.env.SHANON_SUPPORT_EMAIL || fromAddress();

/** adresy prostředí; aktuální = SHANON_PUBLIC_URL, jinak doména služby na Railway, jinak PROD */
export function envUrls() {
  const prod = (process.env.SHANON_PROD_URL || "https://shanon.up.railway.app").replace(/\/$/, "");
  const test = (process.env.SHANON_TEST_URL || "https://shanon-test.up.railway.app").replace(/\/$/, "");
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "";
  const self = (process.env.SHANON_PUBLIC_URL || railway || prod).replace(/\/$/, "");
  return { prod, test, self, isTest: !!test && self === test };
}

/** Odeslat; vrací false, když systémová pošta není nastavená (zpráva jen do logu). Chyba odeslání = výjimka. */
export async function sendSystemMail(m: SystemMail): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (key) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: from(), to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return true;
  }
  if (!process.env.SHANON_SMTP_HOST) {
    console.log(`[system-mail] (neodesláno, chybí RESEND_API_KEY i SHANON_SMTP_HOST) → ${m.to}: ${m.subject}\n${m.text}`);
    return false;
  }
  const port = Number(process.env.SHANON_SMTP_PORT || 587);
  const t = nodemailer.createTransport({
    host: process.env.SHANON_SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: process.env.SHANON_SMTP_USER ? { user: process.env.SHANON_SMTP_USER, pass: process.env.SHANON_SMTP_PASS ?? "" } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  await t.sendMail({ from: from(), to: m.to, replyTo: m.replyTo, subject: m.subject, text: m.text, html: m.html });
  return true;
}
