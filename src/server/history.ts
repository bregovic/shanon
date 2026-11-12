/**
 * Historie změn záznamu ze sys_audit (zapisuje ji datová služba u každé změny).
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError, type RecordData } from "@/core/module";
import { can } from "@/core/security";
import { displayValue } from "@/lib/meta";
import { getObject, inTenant, type Ctx } from "./data";
import { prisma } from "./db";
import type { T } from "./i18n";
import { fieldsMeta } from "./ui";

export interface HistoryEntry {
  at: string;
  user: string;
  action: string;
  changes: { label: string; from: string; to: string }[];
}

export async function recordHistory(ctx: Ctx, objectId: string, recordId: string, t: T, lang: string, client?: PrismaClient): Promise<HistoryEntry[]> {
  const def = getObject(objectId);
  if (!can(ctx.perms, def.id, "read")) throw new UserError("@SYS:NoAccess");
  const rows = await inTenant(
    ctx,
    async (s) => {
      if (!(await s.sys().get(objectId, recordId))) throw new UserError("@SYS:NotFound");
      return s.tx.sysAudit.findMany({ where: { tenantId: ctx.tenantId, objectId, recordId }, orderBy: { createdAt: "desc" }, take: 200 });
    },
    client,
  );
  const meta = fieldsMeta(ctx, def, t);
  const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[];
  const users = await (client ?? prisma).sysUser.findMany({ where: { id: { in: userIds }, tenantId: ctx.tenantId }, select: { id: true, name: true } });
  const userName = new Map(users.map((u) => [u.id, u.name]));

  // titulky odkazů (účet, subjekt…) místo id
  const refIds = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const [k, v] of Object.entries((r.changes as Record<string, unknown[]>) ?? {})) {
      if (meta[k]?.kind !== "ref") continue;
      for (const x of v) if (typeof x === "string") (refIds.get(k) ?? refIds.set(k, new Set()).get(k)!).add(x);
    }
  }
  const titles = new Map<string, string>();
  if (refIds.size) {
    await inTenant(
      ctx,
      async (s) => {
        for (const [field, ids] of refIds) {
          const target = getObject(meta[field].refObject!);
          for (const id of ids) {
            const rec = await s.sys().get(target.id, id).catch(() => null);
            if (rec) titles.set(id, String(rec[target.titleField] ?? ""));
          }
        }
      },
      client,
    );
  }

  const fmt = (field: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return "";
    const m = meta[field];
    if (!m) return typeof v === "object" ? JSON.stringify(v) : String(v);
    if (m.kind === "ref") return titles.get(String(v)) ?? "";
    return displayValue(m, { [field]: v } as RecordData, lang);
  };

  return rows.map((r) => {
    const changes: HistoryEntry["changes"] = [];
    for (const [k, v] of Object.entries((r.changes as Record<string, unknown[]>) ?? {})) {
      if (k.startsWith("docuref:")) {
        changes.push({ label: t("@SYS:AttachmentChange"), from: String(v[0] ?? ""), to: String(v[1] ?? "") });
        continue;
      }
      if (k === "ext") {
        for (const ek of new Set([...Object.keys((v[0] as RecordData) ?? {}), ...Object.keys((v[1] as RecordData) ?? {})])) {
          const a = ((v[0] as RecordData) ?? {})[ek];
          const b = ((v[1] as RecordData) ?? {})[ek];
          if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ label: meta[ek]?.label ?? ek, from: fmt(ek, a), to: fmt(ek, b) });
        }
        continue;
      }
      if (["id", "companyId"].includes(k) || !meta[k]) continue;
      changes.push({ label: meta[k].label, from: fmt(k, v[0]), to: fmt(k, v[1]) });
    }
    return {
      at: r.createdAt.toISOString(),
      user: (r.userId && userName.get(r.userId)) || "",
      action: r.action,
      changes,
    };
  });
}
