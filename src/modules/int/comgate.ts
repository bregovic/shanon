/**
 * Platební brána Comgate (REST API v2.0, https://apidoc.comgate.cz/): založení platby, stav, zrušení.
 *
 * - Ověření: hlavička `Authorization: Basic base64(merchant:secret)`; secret je tajný údaj napojení.
 * - Částky v haléřích (celé číslo), `test: true` = testovací platba (na platební stránce se zvolí výsledek,
 *   peníze se nepohybují). Testovací režim napojení = všechny platby testovací.
 * - Zaplaceno je jen stav PAID; oznámení (push) se vždy ověřuje dotazem na stav u Comgate.
 * - Comgate povoluje volání API jen z IP adres zadaných v klientském portálu.
 */
import { UserError, type RecordData } from "@/core/module";
import { revealSecret } from "@/server/secrets";

export const COMGATE_API = "https://payments.comgate.cz/v2.0";

export interface ComgateCreate {
  amountCents: bigint;
  currency: string;
  /** 1–16 znaků (zobrazí se plátci) */
  label: string;
  /** naše číslo (objednávka, účtenka) */
  refId: string;
  email?: string | null;
  phone?: string | null;
  fullName: string;
  /** návrat plátce po platbě (stejná adresa pro zaplaceno / zrušeno / čeká) */
  returnUrl?: string | null;
}

export interface ComgateResult {
  ok: boolean;
  code: number;
  message: string;
  json: RecordData;
}

function auth(conn: RecordData): string {
  const secret = revealSecret(conn.apiKey);
  if (!conn.merchantCode || !secret) throw new UserError("@INT:ComgateMissing");
  return `Basic ${Buffer.from(`${conn.merchantCode}:${secret}`).toString("base64")}`;
}

async function call(conn: RecordData, method: string, path: string, body?: unknown): Promise<ComgateResult> {
  const res = await fetch(`${COMGATE_API}${path}`, {
    method,
    headers: { Authorization: auth(conn), "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let json: RecordData = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { message: text.slice(0, 200) };
  }
  const code = Number(json.code ?? (res.ok ? 0 : res.status));
  return { ok: res.ok && code === 0, code, message: String(json.message ?? res.statusText ?? ""), json };
}

/** Je napojení v testovacím režimu (testovací platby)? */
export const comgateTest = (conn: RecordData) => !!conn.testMode;

/** Založení platby: vrací transId a adresu platební stránky (pro přesměrování nebo QR). */
export async function comgateCreate(conn: RecordData, p: ComgateCreate): Promise<{ transId: string; redirect: string }> {
  const r = await call(conn, "POST", "/payment.json", {
    test: comgateTest(conn),
    price: Number(p.amountCents),
    curr: p.currency,
    label: p.label.replace(/\s+/g, " ").slice(0, 16) || "Platba",
    refId: p.refId.slice(0, 40),
    method: String(conn.payMethods || "ALL"),
    ...(p.email ? { email: p.email } : {}),
    ...(p.phone ? { phone: p.phone } : {}),
    fullName: p.fullName.slice(0, 100) || "Zákazník",
    country: "CZ",
    lang: "cs",
    ...(p.returnUrl ? { url_paid: p.returnUrl, url_cancelled: p.returnUrl, url_pending: p.returnUrl } : {}),
  });
  if (!r.ok || !r.json.transId || !r.json.redirect) throw new UserError("@INT:ComgateError", { reason: `${r.code} ${r.message}`.trim() });
  return { transId: String(r.json.transId), redirect: String(r.json.redirect) };
}

export type ComgateState = "pending" | "paid" | "cancelled";

/** Stav platby u Comgate (PAID = zaplaceno; AUTHORIZED a PENDING čekají). */
export async function comgateStatus(conn: RecordData, transId: string): Promise<{ state: ComgateState; message: string; priceCents: bigint | null }> {
  const r = await call(conn, "GET", `/payment/transId/${encodeURIComponent(transId)}.json`);
  if (!r.ok) throw new UserError("@INT:ComgateError", { reason: `${r.code} ${r.message}`.trim() });
  const st = String(r.json.status ?? "").toUpperCase();
  const price = /^\d+$/.test(String(r.json.price ?? "")) ? BigInt(String(r.json.price)) : null;
  return {
    state: st === "PAID" ? "paid" : st === "CANCELLED" ? "cancelled" : "pending",
    message: st === "CANCELLED" ? String(r.json.paymentErrorReason || "CANCELLED") : st,
    priceCents: price,
  };
}

/** Zrušení čekající platby (zaplacenou jde jen vrátit). */
export async function comgateCancel(conn: RecordData, transId: string): Promise<void> {
  await call(conn, "DELETE", `/payment/transId/${encodeURIComponent(transId)}.json`).catch(() => undefined);
}

/** Test napojení: seznam platebních metod e-shopu (ověří merchant, secret i povolenou IP). */
export async function comgateTestCall(conn: RecordData): Promise<string> {
  const r = await call(conn, "GET", `/method.json?lang=cs&curr=CZK&country=CZ`);
  if (!r.ok) throw new UserError("@INT:ComgateError", { reason: `${r.code} ${r.message}`.trim() });
  const methods = (Array.isArray(r.json.methods) ? r.json.methods : []) as RecordData[];
  return methods.map((m) => String(m.id ?? m.name ?? "")).filter(Boolean).slice(0, 12).join(", ");
}
