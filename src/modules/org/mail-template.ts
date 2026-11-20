/**
 * Šablona e-mailu dokladů organizace (faktura, zálohová faktura, účtenka) — předmět a text s proměnnými
 * {num} číslo dokladu, {amount} částka, {currency} měna, {due} splatnost, {company} název firmy,
 * {customer} odběratel; podpis pod každým e-mailem. Prázdné pole = výchozí text níže.
 * Výchozí nastavení (orgSetup) texty předvyplní, aby šly upravit.
 */
export type MailDocKind = "invoice" | "advance" | "receipt";

export const MAIL_DEFAULTS: Record<MailDocKind, { subject: string; body: string }> & { signature: string } = {
  invoice: {
    subject: "Faktura {num} – {company}",
    body:
      "Dobrý den,\n\nv příloze vám posíláme fakturu č. {num} na částku {amount} {currency} se splatností {due}.\n\n" +
      "Platební údaje najdete na faktuře, zaplatit můžete i naskenováním QR kódu v bankovní aplikaci. Faktura obsahuje ISDOC pro snadné načtení do účetnictví.\n\n" +
      "Děkujeme za spolupráci. Kdybyste měli jakýkoli dotaz, stačí odpovědět na tento e-mail.",
  },
  advance: {
    subject: "Zálohová faktura {num} – {company}",
    body:
      "Dobrý den,\n\nv příloze vám posíláme zálohovou fakturu (výzvu k platbě) č. {num} na částku {amount} {currency} se splatností {due}.\n\n" +
      "Po připsání platby vám pošleme daňový doklad. Zaplatit můžete i naskenováním QR kódu v bankovní aplikaci.\n\n" +
      "Děkujeme a v případě dotazů stačí odpovědět na tento e-mail.",
  },
  receipt: {
    subject: "Účtenka {num} – {company}",
    body: "Dobrý den,\n\nděkujeme za váš nákup. V příloze najdete účtenku č. {num} na částku {amount} {currency}.\n\nTěšíme se na vaši další návštěvu.",
  },
  signature: "S pozdravem\n{company}",
};

export const MAIL_FIELDS: Record<MailDocKind, { subject: string; body: string }> = {
  invoice: { subject: "mailInvoiceSubject", body: "mailInvoiceBody" },
  advance: { subject: "mailAdvanceSubject", body: "mailAdvanceBody" },
  receipt: { subject: "mailReceiptSubject", body: "mailReceiptBody" },
};

/** Doplnit proměnné {num}, {amount}… (neznámé zůstanou, jak jsou). */
export const fillMail = (text: string, params: Record<string, string>) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? params[k] : m));
