/**
 * Zvoneček: upozornění aktuální firmy pro přihlášeného uživatele (nepřečtená
 * napřed), označení přečtení. Čte systémově — upozornění vidí každý uživatel
 * s přístupem k firmě, i bez práv na správu systému.
 */
import type { Lang } from "@/core/labels";
import { inTenant, type Ctx } from "./data";
import { getT } from "./i18n";

export interface NoticeView {
  id: string;
  kind: string;
  text: string;
  message: string | null;
  href: string | null;
  at: string;
  read: boolean;
}

const LIMIT = 30;

export async function listNotices(ctx: Ctx, lang: Lang): Promise<{ items: NoticeView[]; unread: number }> {
  if (!ctx.companyId) return { items: [], unread: 0 };
  const t = await getT(lang, ctx.tenantId);
  return inTenant(ctx, async (s) => {
    const sys = s.sys();
    // upozornění firmy (bez uživatele) + osobní upozornění přihlášeného
    const all = [...(await sys.find("sys.notification", { userId: null }, LIMIT, { createdAt: "desc" })), ...(await sys.find("sys.notification", { userId: ctx.userId }, LIMIT, { createdAt: "desc" }))]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, LIMIT);
    const read = new Set((await sys.find("sys.notificationRead", { userId: ctx.userId }, 2000)).map((r) => String(r.notificationId)));
    const items = all.map((n) => {
      let params: Record<string, string> = {};
      try {
        params = n.params ? JSON.parse(String(n.params)) : {};
      } catch {
        params = {};
      }
      return { id: String(n.id), kind: String(n.kind), text: t(String(n.title), params), message: (n.message as string) ?? null, href: (n.href as string) ?? null, at: String(n.createdAt), read: read.has(String(n.id)) };
    });
    return { items, unread: items.filter((i) => !i.read).length };
  });
}

/** Označit přečtené (jedno, nebo všechna zobrazená). */
export async function markNoticesRead(ctx: Ctx, ids: string[]): Promise<void> {
  if (!ctx.companyId || !ids.length) return;
  await inTenant(ctx, async (s) => {
    const api = s.sys().api();
    const have = new Set((await api.find("sys.notificationRead", { userId: ctx.userId }, { take: 2000 })).map((r) => String(r.notificationId)));
    for (const id of ids.slice(0, LIMIT)) if (!have.has(id) && (await api.get("sys.notification", id))) await api.create("sys.notificationRead", { notificationId: id, userId: ctx.userId });
  });
}
