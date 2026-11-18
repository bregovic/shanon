/**
 * Upozornění (zvoneček v hlavičce): moduly a dávky hlásí, co selhalo nebo čeká
 * na člověka. Upozornění patří firmě — vidí ho uživatelé s přístupem k firmě;
 * přečtení se eviduje po uživatelích (`sys.notificationRead`).
 *
 * Text = label + parametry (překládá se při zobrazení do jazyka uživatele).
 * `key` zabrání opakování: stejné upozornění se do `dedupeHours` nezaloží znovu.
 */
import type { LabelRef } from "@/core/labels";
import type { DataApi } from "@/core/module";

export interface Notice {
  kind: "info" | "warning" | "error";
  title: LabelRef;
  params?: Record<string, string>;
  /** podrobnost (chybová hláška…) — jak je, nepřekládá se */
  message?: string | null;
  /** odkaz do aplikace (/modul/objekt/id…) */
  href?: string | null;
  key?: string | null;
  dedupeHours?: number;
  /** jen pro tohoto uživatele (řešitel úkolu); bez = všem uživatelům firmy */
  userId?: string | null;
}

export async function notify(data: DataApi, n: Notice): Promise<void> {
  if (n.key) {
    const [last] = await data.find("sys.notification", { key: n.key }, { take: 1, orderBy: { createdAt: "desc" } });
    const hours = n.dedupeHours ?? 24;
    if (last && Date.now() - new Date(String(last.createdAt)).getTime() < hours * 3600_000) return;
  }
  await data.create("sys.notification", {
    kind: n.kind,
    title: n.title,
    params: n.params ? JSON.stringify(n.params) : null,
    message: n.message ? String(n.message).slice(0, 255) : null,
    href: n.href ? n.href.slice(0, 255) : null,
    key: n.key ? n.key.slice(0, 120) : null,
    userId: n.userId ?? null,
  });
}
