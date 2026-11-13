/**
 * Klient EET 2.0 (evidence tržeb od 1. 1. 2027) podle „Popis datového
 * rozhraní“ v1.2 a XSD v4.1 Finanční správy (eet.gov.cz → Pro vývojáře).
 *
 * - SOAP 1.1, operace OdeslaniTrzby, jmenný prostor http://fs.gov.cz/eet/schema/v4
 * - podpis WS-Security: XML-DSig nad <soap:Body>, exc-c14n, SHA-256, RSA-SHA256,
 *   certifikát v BinarySecurityToken (pokladní certifikát .p12 z DIS+)
 * - data jen ASCII (kódy 9, 10, 13, 32–126); částky se 2 desetinnými místy
 * - odpověď: Potvrzeni/@pok (POK), nebo Chyba/@kod (-1 = dočasná chyba → poslat znovu)
 * - mezní doba odezvy 2 s; při výpadku poslat znovu (prvni_zaslani=false)
 *   nejpozději do 48 hodin od tržby
 *
 * Tělo zprávy skládáme rovnou v kanonickém tvaru (exc-c14n): deklarace
 * jmenných prostorů na prvku, který je používá, atributy abecedně, bez
 * zkrácených prázdných prvků. Ověřovatel tak spočítá stejný otisk.
 */
import { createHash, randomUUID, sign } from "node:crypto";
import forge from "node-forge";

export const EET_ENDPOINTS = {
  playground: "https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4",
  production: "https://trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4",
} as const;
export type EetEnvironment = keyof typeof EET_ENDPOINTS;

/** Limit odezvy podle zákona je 2 s; necháme rezervu na síť. */
export const EET_TIMEOUT_MS = 2500;
export const EET_RESEND_HOURS = 48;

const NS = {
  soap: "http://schemas.xmlsoap.org/soap/envelope/",
  wsse: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd",
  wsu: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd",
  ds: "http://www.w3.org/2000/09/xmldsig#",
  eet: "http://fs.gov.cz/eet/schema/v4",
};

export interface EetCert {
  keyPem: string;
  certB64: string;
  /** DIČ z certifikátu (CN), např. CZ8551015704 */
  subject: string;
  validTo: Date;
}

/** Otevře pokladní certifikát (PKCS#12) — klíč a certifikát poplatníka. */
export function openP12(p12Base64: string, password: string): EetCert {
  const asn1 = forge.asn1.fromDer(forge.util.decode64(p12Base64));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  const keyBag = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [])[0];
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((b) => b.cert!).filter(Boolean);
  if (!keyBag?.key || !certs.length) throw new Error("p12 bez klíče nebo certifikátu");
  // certifikát poplatníka = ten, jehož veřejný klíč patří k soukromému klíči
  const key = keyBag.key as forge.pki.rsa.PrivateKey;
  const own = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n.equals(key.n)) ?? certs[0];
  const cn = own.subject.getField("CN")?.value as string | undefined;
  return {
    keyPem: forge.pki.privateKeyToPem(key),
    certB64: forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(own)).getBytes()),
    subject: String(cn ?? ""),
    validTo: own.validity.notAfter,
  };
}

/** Datum a čas v pražském pásmu s posunem: 2027-01-07T22:01:00+01:00. */
export function pragueDateTime(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Prague",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const off = Math.round((local - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const sign = off >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const mm = String(Math.abs(off) % 60).padStart(2, "0");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${hh}:${mm}`;
}

/** Jen znaky povolené rozhraním (ASCII 32–126), diakritika pryč. */
export const eetAscii = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "");

const attrEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
/** atributy v kanonickém pořadí (bez jmenného prostoru → podle názvu) */
const attrs = (o: Record<string, string | null | undefined>) =>
  Object.keys(o)
    .filter((k) => o[k] !== null && o[k] !== undefined && o[k] !== "")
    .sort()
    .map((k) => ` ${k}="${attrEsc(String(o[k]))}"`)
    .join("");

export interface EetSale {
  /** DIČ poplatníka (CZ…) */
  eic: string;
  unitId: string;
  posId: string;
  /** pořadové číslo = číslo účtenky */
  seq: string;
  date: Date;
  /** celková částka tržby, např. "246.00" */
  amount: string;
}

export interface EetMessage {
  uuid: string;
  xml: string;
  body: string;
}

/** Datová zpráva evidované tržby podepsaná pokladním certifikátem. */
export function buildEetMessage(sale: EetSale, cert: EetCert, opts: { first: boolean; verify: boolean; uuid?: string; sentAt?: Date }): EetMessage {
  const uuid = opts.uuid ?? randomUUID();
  const amount = Number(sale.amount).toFixed(2).replace(/^-0\.00$/, "0.00");
  const hlavicka = attrs({
    dat_odesl: pragueDateTime(opts.sentAt ?? new Date()),
    overeni: opts.verify ? "true" : null,
    prvni_zaslani: opts.first ? "true" : "false",
    uuid_zpravy: uuid,
  });
  const data = attrs({
    celk_trzba: amount,
    dat_trzby: pragueDateTime(sale.date),
    eic_popl: sale.eic,
    id_jednotky: sale.unitId,
    id_pokl: eetAscii(sale.posId),
    porad_cis: eetAscii(sale.seq),
  });
  const bodyId = `id-${uuid}`;
  // kanonický tvar: xmlns:soap a xmlns:wsu (seřazené podle prefixu) na Body, xmlns:eet na Trzba
  const body =
    `<soap:Body xmlns:soap="${NS.soap}" xmlns:wsu="${NS.wsu}" wsu:Id="${bodyId}">` +
    `<eet:Trzba xmlns:eet="${NS.eet}"><eet:Hlavicka${hlavicka}></eet:Hlavicka><eet:Data${data}></eet:Data></eet:Trzba>` +
    `</soap:Body>`;
  const digest = createHash("sha256").update(body, "utf8").digest("base64");
  const tokenId = `X509-${uuid}`;
  const signedInfo =
    `<ds:SignedInfo xmlns:ds="${NS.ds}">` +
    `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></ds:SignatureMethod>` +
    `<ds:Reference URI="#${bodyId}">` +
    `<ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></ds:Transform></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>` +
    `<ds:DigestValue>${digest}</ds:DigestValue>` +
    `</ds:Reference></ds:SignedInfo>`;
  const signature = sign("sha256", Buffer.from(signedInfo, "utf8"), cert.keyPem).toString("base64");
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="${NS.soap}"><soap:Header>` +
    `<wsse:Security xmlns:wsse="${NS.wsse}" xmlns:wsu="${NS.wsu}" soap:mustUnderstand="1">` +
    `<wsse:BinarySecurityToken EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary" ` +
    `ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3" wsu:Id="${tokenId}">${cert.certB64}</wsse:BinarySecurityToken>` +
    `<ds:Signature xmlns:ds="${NS.ds}">${signedInfo}<ds:SignatureValue>${signature}</ds:SignatureValue>` +
    `<ds:KeyInfo><wsse:SecurityTokenReference><wsse:Reference URI="#${tokenId}" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"></wsse:Reference></wsse:SecurityTokenReference></ds:KeyInfo>` +
    `</ds:Signature></wsse:Security></soap:Header>` +
    body +
    `</soap:Envelope>`;
  return { uuid, xml, body };
}

export type EetResult =
  | { status: "ok"; pok: string; test: boolean; warnings: string[]; txId: string | null }
  | { status: "verified"; warnings: string[]; txId: string | null }
  | { status: "error"; code: number; message: string; retry: boolean; txId: string | null }
  | { status: "timeout"; message: string };

/** Rozbor odpovědi (Potvrzeni / Chyba / Varovani). */
export function parseEetResponse(xml: string, txId: string | null = null): EetResult {
  const attr = (el: string, a: string) => new RegExp(`<(?:\\w+:)?${el}\\b[^>]*\\s${a}="([^"]*)"`).exec(xml)?.[1] ?? null;
  const warnings = [...xml.matchAll(/<(?:\w+:)?Varovani\b[^>]*kod_varov="(\d+)"[^>]*>([^<]*)</g)].map((m) => `${m[1]}: ${m[2].trim()}`);
  const pok = attr("Potvrzeni", "pok");
  if (pok) return { status: "ok", pok, test: attr("Potvrzeni", "test") === "true", warnings, txId };
  const kod = attr("Chyba", "kod");
  if (kod !== null) {
    const code = Number(kod);
    const message = (/<(?:\w+:)?Chyba\b[^>]*>([^<]*)</.exec(xml)?.[1] ?? "").trim();
    if (code === 0) return { status: "verified", warnings, txId };
    return { status: "error", code, message, retry: code < 0, txId };
  }
  const fault = /<faultstring[^>]*>([^<]*)</.exec(xml)?.[1];
  return { status: "error", code: -1, message: fault ?? "Neznámá odpověď", retry: true, txId };
}

/** Odeslání zprávy; po limitu odezvy vrací timeout (zprávu pak poslat znovu). */
/** Poslední výměna se serverem EET (zpráva a odpověď) — pro protokol komunikace. */
let lastExchange: { request: string; response: string | null; status: number } | null = null;
export function takeLastExchange() {
  const x = lastExchange;
  lastExchange = null;
  return x;
}

export async function sendEet(env: EetEnvironment, xml: string, timeoutMs = EET_TIMEOUT_MS): Promise<EetResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(EET_ENDPOINTS[env], {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '"http://fs.gov.cz/eet/OdeslaniTrzby"' },
      body: xml,
      signal: ctrl.signal,
    });
    const text = await res.text();
    // surová odpověď do protokolu komunikace (řešení chyb s Finanční správou)
    lastExchange = { request: xml, response: text, status: res.status };
    return parseEetResponse(text, res.headers.get("X-Global-Transaction-Id"));
  } catch (e) {
    lastExchange = { request: xml, response: null, status: 0 };
    return { status: "timeout", message: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}
