/**
 * Tajné údaje v polích objektů (hesla certifikátů, API klíče, certifikáty).
 *
 * Pole s `FieldDef.secret` se v databázi ukládá šifrovaně (AES-256-GCM,
 * klíč z proměnné SHANON_SECRET_KEY, 32 bajtů v base64). Uživateli se nikdy
 * nevrací — v UI, exportu i historii je jen maska. Číst ho smí jen logika
 * modulu přes `revealSecret()`.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const SECRET_MASK = "••••••";
const PREFIX = "enc:v1:";

function key(): Buffer {
  const k = process.env.SHANON_SECRET_KEY;
  if (k) {
    const b = Buffer.from(k, "base64");
    if (b.length !== 32) throw new Error("SHANON_SECRET_KEY musí být 32 bajtů v base64");
    return b;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Chybí SHANON_SECRET_KEY");
  // vývoj a testy: pevný klíč (nikdy pro ostrá data)
  return createHash("sha256").update("shanon-dev-only").digest();
}

export const isEncrypted = (v: unknown) => typeof v === "string" && v.startsWith(PREFIX);

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
}

export function revealSecret(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (!isEncrypted(v)) return String(v);
  const raw = Buffer.from(String(v).slice(PREFIX.length), "base64");
  const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}
