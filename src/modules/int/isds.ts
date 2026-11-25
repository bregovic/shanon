/**
 * Datová schránka (ISDS) — odeslání podání (XML přiznání / kontrolního hlášení podle Pokynu D-349) datovou zprávou
 * do schránky finančního úřadu. Nic se nepodepisuje, podáním je samotná datová zpráva.
 *
 * Rozhraní: SOAP 1.1, jmenný prostor http://isds.czechpoint.cz/v20; odeslání `CreateMessage` (<base>/DS/dz),
 * ověření přihlášení `GetOwnerInfoFromLogin` (<base>/DS/DsManage). Ostrý provoz ws1.datovka.gov.cz (ovladač `isds`),
 * veřejný test ws1.czebox.cz (ovladač `isdsTest`, vlastní testovací schránka). Převzato z DMS (src/server/isds.ts).
 */
import { UserError, type RecordData } from "@/core/module";
import { revealSecret } from "@/server/secrets";
import { liveBlocked } from "./live-guard";

const NS = "http://isds.czechpoint.cz/v20";
const base = (conn: RecordData) => (conn.driver === "isdsTest" ? "https://ws1.czebox.cz" : "https://ws1.datovka.gov.cz");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tag = (xml: string, name: string) => new RegExp(`<[^>]*\\b${name}[^>]*>([^<]*)<`).exec(xml)?.[1]?.trim();

function credentials(conn: RecordData) {
  // testovací server: ostrá schránka jen s ručním povolením u napojení — zkušební podání nesmí odejít na úřad
  if (liveBlocked(conn)) throw new UserError("@INT:IsdsLiveOnTest");
  const login = String(conn.isdsLogin ?? "").trim();
  const password = revealSecret(conn.isdsPassword) ?? "";
  if (!login || !password) throw new UserError("@INT:IsdsNoLogin");
  return { login, password };
}

async function soap(conn: RecordData, path: string, op: string, inner: string): Promise<string> {
  const { login, password } = credentials(conn);
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:p="${NS}"><soap:Body>${inner}</soap:Body></soap:Envelope>`;
  let res: Response;
  try {
    res = await fetch(`${base(conn)}${path}`, {
      method: "POST",
      headers: { "content-type": "text/xml; charset=utf-8", soapaction: `"${NS}/${op}"`, authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}` },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new UserError("@INT:IsdsUnreachable", { error: e instanceof Error ? e.message : String(e) });
  }
  const text = await res.text();
  if (res.status === 401) throw new UserError("@INT:IsdsBadLogin");
  // 0000 = v pořádku; jiný kód je chyba ISDS i při HTTP 200
  const code = tag(text, "dmStatusCode") ?? tag(text, "dbStatusCode");
  const message = tag(text, "dmStatusMessage") ?? tag(text, "dbStatusMessage");
  if (!res.ok && !code) throw new UserError("@INT:IsdsHttp", { status: String(res.status) });
  if (code && code !== "0000") throw new UserError("@INT:IsdsError", { code, message: message ?? "" });
  return text;
}

/** Ověření přihlášení: ID vlastní datové schránky. */
export async function isdsOwnBox(conn: RecordData): Promise<string> {
  const xml = await soap(conn, "/DS/DsManage", "GetOwnerInfoFromLogin", `<p:GetOwnerInfoFromLogin><p:dbDummy/></p:GetOwnerInfoFromLogin>`);
  return tag(xml, "dbID") ?? "";
}

/** Odeslání datové zprávy s jedním XML souborem; vrací ID zprávy. */
export async function isdsSend(conn: RecordData, m: { recipient: string; annotation: string; fileName: string; xml: string }): Promise<string> {
  const recipient = m.recipient.trim();
  if (!/^[a-z0-9]{7}$/i.test(recipient)) throw new UserError("@INT:IsdsBadRecipient");
  const xml = await soap(
    conn,
    "/DS/dz",
    "CreateMessage",
    `<p:CreateMessage><p:dmEnvelope><p:dbIDRecipient>${esc(recipient)}</p:dbIDRecipient><p:dmAnnotation>${esc(m.annotation.slice(0, 255))}</p:dmAnnotation><p:dmAllowSubstDelivery>true</p:dmAllowSubstDelivery></p:dmEnvelope><p:dmFiles><p:dmFile dmMimeType="application/xml" dmFileMetaType="main" dmFileDescr="${esc(m.fileName)}"><p:dmEncodedContent>${Buffer.from(m.xml, "utf8").toString("base64")}</p:dmEncodedContent></p:dmFile></p:dmFiles></p:CreateMessage>`,
  );
  const id = tag(xml, "dmID");
  if (!id) throw new UserError("@INT:IsdsNoId");
  return id;
}
