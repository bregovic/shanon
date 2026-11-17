/**
 * Oznámení platební brány o změně stavu platby (veřejné, bez přihlášení).
 *
 * Comgate posílá POST na adresu z napojení (/api/pay/comgate/<tenant>/<napojení>). Tělu se nevěří:
 * podle transId se najde zahájení platby v protokolu napojení a stav se ověří dotazem u brány
 * (`settleGatewayLog`). Odpověď 200 = přijato (i neznámá platba, aby brána neopakovala donekonečna).
 */
import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { dependencyClosure } from "@/core/module";
import { ADMIN } from "@/core/security";
import { registry } from "@/registry";
import { prisma, withTenant } from "./db";
import { inTenant, type Ctx } from "./data";
import { settleGatewayLog } from "./eshop";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function comgatePush(tenantId: string, connId: string, transId: string, client: PrismaClient = prisma): Promise<"ok" | "unknown"> {
  if (!UUID.test(tenantId) || !UUID.test(connId) || !/^[A-Za-z0-9-]{4,40}$/.test(transId)) return "unknown";
  const tenant = await client.sysTenant.findUnique({ where: { id: tenantId }, include: { modules: true, users: { where: { role: "admin" }, take: 1 } } });
  if (!tenant || !tenant.modules.some((m) => m.moduleId === "int")) return "unknown";
  const raw = await withTenant(tenantId, (tx) => tx.intConnection.findFirst({ where: { tenantId, id: connId } }), client);
  if (!raw?.companyId) return "unknown";
  const ctx: Ctx = {
    tenantId,
    companyId: String(raw.companyId),
    userId: String(tenant.users[0]?.id ?? tenantId),
    userName: "Platební brána",
    role: "admin",
    perms: ADMIN,
    modules: new Set([...dependencyClosure(registry, ["sys", ...tenant.modules.map((m) => m.moduleId)])].filter((x) => registry.modules.has(x))),
    extensions: new Set(),
    lang: "cs",
  };
  const found = await inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      const conn = await api.get("int.connection", connId);
      if (!conn || conn.driver !== "comgate") return null;
      const [log] = await api.find("int.log", { connectionId: connId, externalId: transId, operation: "payment.start" }, { take: 1 });
      return log ? { conn, log } : null;
    },
    client,
  );
  if (!found) return "unknown";
  await settleGatewayLog(ctx, found.conn, found.log, client); // chyba sítě → výjimka → 500 → brána zopakuje
  return "ok";
}
