/** Párovací kód tiskové stanice (do osobního instalátoru) — v DB jen otisk. Bez dalších importů (volají ho obsluhy modulů). */
import { createHash, randomBytes } from "node:crypto";

export const PAIR_DAYS = 3;
export const stationSha = (s: string) => createHash("sha256").update(s).digest("hex");

export function newPairCode(tenantId: string) {
  const code = `shp.${tenantId}.${randomBytes(18).toString("base64url")}`;
  return { code, hash: stationSha(code), expires: new Date(Date.now() + PAIR_DAYS * 86_400_000) };
}
