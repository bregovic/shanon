/**
 * REST API (Integrace → Napojení druhu API).
 *
 * Klíč: `shn.<tenantId>.<náhodný řetězec>` — v databázi jen jeho SHA-256
 * otisk (int.connection.tokenHash). Rozsah napojení (`scopes`, moduly nebo
 * objekty oddělené čárkou) = oprávnění Upravovat; mazat přes API nejde.
 * Vše jde přes datovou službu (RLS, validace, události, historie změn).
 */
import "server-only";
import { dependencyClosure } from "@/core/module";
import type { Perms } from "@/core/security";
import { registry } from "@/registry";
import { prisma, withTenant } from "./db";
import type { Ctx } from "./data";
import { tokenHash } from "./api-token";

/** Kontext požadavku podle klíče; null = neplatný nebo neaktivní klíč. */
export async function apiContext(authorization: string | null): Promise<{ ctx: Ctx; scopes: string[]; connectionId: string } | null> {
  const m = /^Bearer\s+(shn\.([0-9a-f-]{36})\.[A-Za-z0-9_-]{20,})$/.exec(authorization ?? "");
  if (!m) return null;
  const [, token, tenantId] = m;
  const conn = await withTenant(tenantId, (tx) =>
    tx.intConnection.findFirst({ where: { tenantId, kind: "api", active: true, tokenHash: tokenHash(token) } }),
  );
  if (!conn) return null;
  const tenant = await prisma.sysTenant.findUnique({ where: { id: tenantId }, include: { modules: true } });
  if (!tenant) return null;
  const modules = new Set([...dependencyClosure(registry, ["sys", ...tenant.modules.map((x) => x.moduleId)])].filter((x) => registry.modules.has(x)));
  const scopes = String(conn.scopes ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const perms: Perms = { admin: false, levels: Object.fromEntries(scopes.map((s) => [s, "write" as const])) };
  return {
    connectionId: conn.id,
    scopes,
    ctx: {
      tenantId,
      companyId: conn.companyId,
      userId: conn.createdBy ?? conn.id,
      userName: `API · ${conn.name}`,
      role: "api",
      perms,
      modules,
      extensions: new Set(),
      lang: "cs",
    },
  };
}
