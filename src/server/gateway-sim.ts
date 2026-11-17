/**
 * Simulátor platební brány (testovací prostředí): veřejná testovací platební stránka
 * /pay-sim/<tenant>/<protokol> s tlačítky Zaplatit / Zrušit. Volba se zapíše do protokolu zahájení
 * platby (`sim=PAID` / `sim=CANCELLED`) a vyhodnotí stejně jako u skutečné brány (`settleGatewayLog`):
 * objednávka e-shopu → K vyřízení, pokladna si stav načte sama. Jen pro napojení s ovladačem gatewaySim.
 */
import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { dependencyClosure, type RecordData } from "@/core/module";
import { ADMIN } from "@/core/security";
import { registry } from "@/registry";
import { prisma, withTenant } from "./db";
import { inTenant, type Ctx } from "./data";
import { settleGatewayLog } from "./eshop";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(tenantId: string, logId: string, client: PrismaClient): Promise<{ ctx: Ctx; log: RecordData; conn: RecordData; company: string } | null> {
  if (!UUID.test(tenantId) || !UUID.test(logId)) return null;
  const tenant = await client.sysTenant.findUnique({ where: { id: tenantId }, include: { modules: true, users: { where: { role: "admin" }, take: 1 } } });
  if (!tenant || !tenant.modules.some((m) => m.moduleId === "int")) return null;
  const raw = await withTenant(tenantId, (tx) => tx.intLog.findFirst({ where: { tenantId, id: logId } }), client);
  if (!raw?.companyId) return null;
  const ctx: Ctx = {
    tenantId,
    companyId: String(raw.companyId),
    userId: String(tenant.users[0]?.id ?? tenantId),
    userName: "Simulátor brány",
    role: "admin",
    perms: ADMIN,
    modules: new Set([...dependencyClosure(registry, ["sys", ...tenant.modules.map((m) => m.moduleId)])].filter((x) => registry.modules.has(x))),
    extensions: new Set(),
    lang: "cs",
  };
  return inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      const log = await api.get("int.log", logId);
      const conn = log?.connectionId ? await api.get("int.connection", String(log.connectionId)) : null;
      if (!log || !conn || conn.driver !== "gatewaySim" || log.operation !== "payment.start") return null;
      const company = (await api.get("sys.company", String(raw.companyId)))?.name ?? "";
      return { ctx, log, conn, company: String(company) };
    },
    client,
  );
}

export interface SimPayment {
  company: string;
  reference: string;
  amount: string;
  /** pending | PAID | CANCELLED */
  state: string;
  returnUrl: string | null;
}

export async function simPayment(tenantId: string, logId: string, client: PrismaClient = prisma): Promise<SimPayment | null> {
  const l = await load(tenantId, logId, client);
  if (!l) return null;
  const detail = String(l.log.detail ?? "");
  const cents = Number(/amount=(-?\d+)/.exec(detail)?.[1] ?? 0);
  return {
    company: l.company,
    reference: String(l.log.reference ?? ""),
    amount: (cents / 100).toFixed(2),
    state: /sim=(PAID|CANCELLED)/.exec(detail)?.[1] ?? (l.log.status === "pending" ? "pending" : String(l.log.status)),
    returnUrl: /return=(\S+)/.exec(detail)?.[1] ?? null,
  };
}

/** Volba na testovací stránce; vrací adresu návratu (e-shop) nebo null (pokladna: hotovo v telefonu). */
export async function simDecide(tenantId: string, logId: string, paid: boolean, client: PrismaClient = prisma): Promise<{ ok: boolean; returnUrl: string | null }> {
  const l = await load(tenantId, logId, client);
  if (!l) return { ok: false, returnUrl: null };
  const detail = String(l.log.detail ?? "");
  if (l.log.status === "pending" && !/sim=/.test(detail)) {
    await inTenant(l.ctx, (s) => s.sys().api().update("int.log", logId, { detail: `${detail} sim=${paid ? "PAID" : "CANCELLED"}` }), client);
    const fresh = await inTenant(l.ctx, (s) => s.sys().api().get("int.log", logId), client);
    if (fresh) await settleGatewayLog(l.ctx, l.conn, fresh, client);
  }
  return { ok: true, returnUrl: /return=(\S+)/.exec(detail)?.[1] ?? null };
}
