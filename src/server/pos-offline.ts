/**
 * Prodeje z kasy uložené bez připojení (src/lib/pos-offline.ts) → účtenky v Shanonu.
 *
 * Každý prodej má id z kasy (`clientId`): opakované odeslání vrátí stejnou účtenku, takže ztracená odpověď
 * ani druhé odeslání neudělá dvojí prodej. Prodej po prodeji ve vlastní transakci — chyba jednoho (např. žádná
 * otevřená směna) ostatní nezastaví; neodeslaný zůstane v kase s hláškou. EET se odešle dodatečně (ne první
 * zaslání), čekající tržby pak dožene dodatečné odeslání pokladny.
 */
import "server-only";
import { UserError } from "@/core/module";
import { can } from "@/core/security";
import { connectionsFor, eetRegisterReceipt, eetResendPending } from "@/modules/int/drivers";
import { sellOffline, type OfflineSale } from "@/modules/pos/sale";
import { inTenant, type Ctx } from "./data";
import { getT } from "./i18n";

export interface OfflineResult {
  clientId: string;
  ok: boolean;
  receiptNum?: string;
  message?: string;
}

const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);

/** vstup z kasy: jen očekávané texty (kontrolu tvaru dělá sellOffline) */
function offlineInput(v: unknown): OfflineSale {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const lines = Array.isArray(o.lines) ? o.lines.slice(0, 500) : [];
  return {
    clientId: str(o.clientId, 36),
    registerId: str(o.registerId, 36),
    shiftId: o.shiftId ? str(o.shiftId, 36) : null,
    receiptNum: str(o.receiptNum, 20),
    soldAt: str(o.soldAt, 40),
    payment: o.payment === "card" ? "card" : "cash",
    cashGiven: o.cashGiven ? str(o.cashGiven, 20) : null,
    lines: lines.map((x) => {
      const l = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      const sc = l.scale && typeof l.scale === "object" ? (l.scale as Record<string, unknown>) : null;
      return {
        itemId: str(l.itemId, 36),
        qty: str(l.qty, 20),
        unitPrice: str(l.unitPrice, 20),
        scale: sc ? { weight: str(sc.weight, 20), unitPrice: str(sc.unitPrice, 20), total: str(sc.total, 20), raw: str(sc.raw, 2000), weighedAt: str(sc.weighedAt, 40) } : null,
      };
    }),
  };
}

export async function syncOfflineSales(ctx: Ctx, body: unknown): Promise<{ results: OfflineResult[]; eetQueue?: number }> {
  if (!can(ctx.perms, "pos.receipt", "write")) throw new UserError("@SYS:NoAccess");
  const sales = (Array.isArray((body as { sales?: unknown })?.sales) ? (body as { sales: unknown[] }).sales : []).slice(0, 50).map(offlineInput);
  const t = await getT(ctx.lang === "en" ? "en" : "cs", ctx.tenantId);
  const results: OfflineResult[] = [];
  const created: { id: string; registerId: string }[] = [];
  for (const sale of sales) {
    try {
      const { receipt, existed } = await inTenant(ctx, (s) => sellOffline(s.sys().api(), sale));
      if (!existed) created.push({ id: String(receipt.id), registerId: sale.registerId });
      results.push({ clientId: sale.clientId, ok: true, receiptNum: String(receipt.receiptNum) });
    } catch (e) {
      results.push({ clientId: sale.clientId, ok: false, message: e instanceof UserError ? t(e.label, e.params) : e instanceof Error ? e.message : String(e) });
    }
  }
  // EET po zápisu (síť nesmí držet transakci)
  let eetQueue: number | undefined;
  if (created.length && ctx.modules.has("int")) {
    await inTenant(ctx, async (s) => {
      const api = s.sys().api();
      for (const regId of new Set(created.map((c) => c.registerId))) {
        const conns = await connectionsFor(api, regId);
        if (!conns.eet) continue;
        for (const c of created.filter((x) => x.registerId === regId)) {
          const r = await api.get("pos.receipt", c.id);
          if (r) await eetRegisterReceipt(api, ctx.companyId, conns.eet, r, false).catch(() => null);
        }
        eetQueue = (await eetResendPending(api, ctx.companyId, regId, 5)).pending;
      }
    }).catch(() => null);
  }
  return { results, eetQueue };
}
