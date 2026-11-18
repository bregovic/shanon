/**
 * Systémová pošta aplikace (pozvánky, reset hesla, „nemůžu se přihlásit“) — nezávislá na firmě a jejím
 * napojení pošty v Integraci. Server SMTP jen z prostředí, nikdy z databáze ani z repa:
 *
 *   SHANON_SMTP_HOST, SHANON_SMTP_PORT (587 = STARTTLS, 465 = TLS), SHANON_SMTP_USER, SHANON_SMTP_PASS,
 *   SHANON_SMTP_FROM (adresa odesílatele, výchozí = USER), SHANON_SMTP_FROM_NAME (výchozí „Shanon“)
 *   SHANON_SUPPORT_EMAIL — kam chodí „Nemůžu se přihlásit“ (výchozí = odesílatel)
 *   SHANON_PROD_URL, SHANON_TEST_URL — adresy prostředí do pozvánky
 *
 * Bez SHANON_SMTP_HOST se nic neodesílá: zpráva se jen vypíše do logu serveru (vývoj, testy).
 */
import nodemailer from "nodemailer";

export interface SystemMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

export const systemMailConfigured = () => !!process.env.SHANON_SMTP_HOST;

function from() {
  const address = process.env.SHANON_SMTP_FROM || process.env.SHANON_SMTP_USER || "";
  return { name: process.env.SHANON_SMTP_FROM_NAME || "Shanon", address };
}

export const supportEmail = () => process.env.SHANON_SUPPORT_EMAIL || from().address;

/** adresy prostředí; aktuální = SHANON_PUBLIC_URL, jinak doména služby na Railway, jinak PROD */
export function envUrls() {
  const prod = (process.env.SHANON_PROD_URL || "https://shanon.up.railway.app").replace(/\/$/, "");
  const test = (process.env.SHANON_TEST_URL || "https://shanon-test.up.railway.app").replace(/\/$/, "");
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "";
  const self = (process.env.SHANON_PUBLIC_URL || railway || prod).replace(/\/$/, "");
  return { prod, test, self, isTest: !!test && self === test };
}

/** Odeslat; vrací false, když systémová pošta není nastavená (zpráva jen do logu). */
export async function sendSystemMail(m: SystemMail): Promise<boolean> {
  if (!systemMailConfigured()) {
    console.log(`[system-mail] (neodesláno, chybí SHANON_SMTP_HOST) → ${m.to}: ${m.subject}\n${m.text}`);
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
