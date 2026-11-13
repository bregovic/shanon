/** Klíč REST API: `shn.<tenantId>.<náhodný řetězec>`, v databázi jen SHA-256 otisk. */
import { createHash, randomBytes } from "node:crypto";

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export function newToken(tenantId: string) {
  const token = `shn.${tenantId}.${randomBytes(24).toString("base64url")}`;
  return { token, hash: tokenHash(token), prefix: `${token.slice(0, 12)}…${token.slice(-4)}` };
}
