/**
 * Systémová pošta aplikace (pozvánky, reset hesla, „nemůžu se přihlásit“) — nezávislá na firmě a jejím
 * napojení pošty v Integraci. Nastavení jen z prostředí, nikdy z databáze ani z repa:
 *
 *   RESEND_API_KEY — odesílání přes Resend (HTTPS). Na Railway jediná cesta: odchozí SMTP Railway blokuje.
 *   SHANON_MAIL_FROM — odesílatel, např. „Shanon <posta@vase-domena.cz>“ (doména musí být ověřená v Resendu)
 *   SHANON_SMTP_HOST, _PORT (587 STARTTLS / 465 TLS), _USER, _PASS — místo Resendu, jen na vlastním hostingu
 *   SHANON_SUPPORT_EMAIL — kam chodí „Nemůžu se přihlásit“ (výchozí = odesílatel)
 *   SHANON_PUBLIC_URL — adresa tohoto prostředí (odkazy v e-mailech: pozvánky, portál)
 *   SHANON_PROD_URL, SHANON_TEST_URL — adresy produkce a testu do pozvánky (nepovinné)
 *
 * Žádné výchozí adresy v kódu: chybí odesílatel nebo Resend / SMTP = pošta není nastavená (vývoj a testy:
 * zpráva jen do logu; produkce: chyba s hláškou). Chybí SHANON_PUBLIC_URL = odkaz nejde sestavit (produkce: chyba).
 */
import { UserError } from "@/core/module";
import nodemailer from "nodemailer";

export interface SystemMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

/** „Jméno <adresa>“ odesílatele z prostředí; bez nastavení null */
function from(): string | null {
  if (process.env.SHANON_MAIL_FROM) return process.env.SHANON_MAIL_FROM;
  const address = process.env.SHANON_SMTP_FROM || process.env.SHANON_SMTP_USER;
  return address ? `${process.env.SHANON_SMTP_FROM_NAME || "Shanon"} <${address}>` : null;
}

const fromAddress = () => from()?.replace(/^.*<([^>]+)>.*$/, "$1") ?? null;

/** pošta je nastavená: odesílatel + Resend nebo SMTP */
export const systemMailConfigured = () => !!from() && (!!process.env.RESEND_API_KEY || !!process.env.SHANON_SMTP_HOST);

const isProduction = () => process.env.NODE_ENV === "production";

export const supportEmail = () => process.env.SHANON_SUPPORT_EMAIL || fromAddress();

/**
 * Adresy prostředí; aktuální = SHANON_PUBLIC_URL, jinak podle prostředí Railway (test / production).
 * RAILWAY_PUBLIC_DOMAIN se nebere: je to vygenerovaná doména služby (shanon-app-test…), ne adresa, kterou používáme.
 */
export function envUrls() {
  const clean = (v: string | undefined) => (v ?? "").trim().replace(/\/$/, "");
  const prod = clean(process.env.SHANON_PROD_URL);
  const test = clean(process.env.SHANON_TEST_URL);
  const envName = process.env.RAILWAY_ENVIRONMENT_NAME;
  const self = clean(process.env.SHANON_PUBLIC_URL) || (envName === "test" ? test : prod);
  return { prod, test, self, isTest: !!test && self === test };
}

/** Adresa tohoto prostředí pro odkazy v e-mailech; v produkci bez nastavení chyba (vývoj: místní server). */
export function publicUrl(): string {
  const { self } = envUrls();
  if (self) return self;
  if (isProduction()) throw new UserError("@SYS:PublicUrlMissing");
  return `http://localhost:${process.env.PORT || 3000}`;
}

/** Odeslat; vrací false, když systémová pošta není nastavená (zpráva jen do logu). Chyba odeslání = výjimka. */
export async function sendSystemMail(m: SystemMail): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const sender = from();
  if (!m.to) throw new UserError("@SYS:MailNotConfigured");
  if (!sender || (!key && !process.env.SHANON_SMTP_HOST)) {
    if (isProduction()) throw new UserError("@SYS:MailNotConfigured");
    console.log(`[system-mail] (neodesláno, pošta není nastavená) → ${m.to}: ${m.subject}\n${m.text}`);
    return false;
  }
  if (key) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: sender, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return true;
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
  await t.sendMail({ from: sender, to: m.to, replyTo: m.replyTo, subject: m.subject, text: m.text, html: m.html });
  return true;
}

export interface PlatformMail {
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  /** jméno odesílatele (firma); adresa je vždy adresa platformy (ověřená doména) */
  fromName?: string;
  /** kam jdou odpovědi (e-mail firmy) */
  replyTo?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

/**
 * Pošta dokladů firmy přes platformu (napojení pošty s ovladačem „Systémová pošta Shanonu“): odesílá adresa
 * platformy se jménem firmy, odpovědi na e-mail firmy. Vrací id zprávy; bez nastavené pošty jen log (vývoj, testy).
 */
export async function sendPlatformMail(m: PlatformMail): Promise<string> {
  const address = fromAddress();
  const key = process.env.RESEND_API_KEY;
  if (!address || (!key && !process.env.SHANON_SMTP_HOST)) {
    if (isProduction()) throw new UserError("@INT:MailSystemOff");
    console.log(`[platform-mail] (neodesláno, pošta není nastavená) → ${m.to.join(", ")}: ${m.subject}`);
    return `local-${Date.now()}@shanon.local`;
  }
  const sender = m.fromName ? `${m.fromName.replace(/[<>"]/g, "").slice(0, 80)} <${address}>` : from()!;
  if (key) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: sender,
        to: m.to,
        ...(m.cc?.length ? { cc: m.cc } : {}),
        subject: m.subject,
        text: m.text,
        ...(m.html ? { html: m.html } : {}),
        ...(m.replyTo ? { reply_to: m.replyTo } : {}),
        ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })) } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = (await res.json().catch(() => ({}))) as { id?: string };
    return String(j.id ?? `resend-${Date.now()}`);
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
    socketTimeout: 30_000,
  });
  const info = await t.sendMail({ from: sender, to: m.to, cc: m.cc, replyTo: m.replyTo, subject: m.subject, text: m.text, html: m.html, attachments: m.attachments });
  return String(info.messageId ?? "");
}
