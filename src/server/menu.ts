/**
 * Menu aplikace pro uživatele: položky všech zapnutých modulů, které smí
 * vidět (objekty s právem číst, správa jen pro správce). Jeden zdroj pro
 * plochu modulu, vyhledávání v přehledu i v hlavičce.
 */
import "server-only";
import type { MenuGroup, ModuleDef } from "@/core/module";
import { can, canSeeModule } from "@/core/security";
import { registry } from "@/registry";
import { isAnyAdmin, type AppSession as Session } from "./auth";
import type { T } from "./i18n";
import { objectHref } from "./ui";

export type MenuKind = "forms" | "setup" | "functions" | "reports";

export interface MenuEntry {
  module: string;
  moduleLabel: string;
  icon: string;
  section: string;
  kind: MenuKind;
  label: string;
  href: string;
}

/** Druh sekce: výslovně z definice, jinak Nastavení/Zabezpečení = nastavení, ostatní formuláře. */
export const kindOf = (g: MenuGroup): MenuKind => g.kind ?? (g.label === "@SYS:Setup" || g.label === "@SYS:Security" ? "setup" : "forms");

export function visibleModules(s: Session): ModuleDef[] {
  return [...registry.modules.values()].filter((m) => s.ctx.modules.has(m.id) && canSeeModule(s.ctx.perms, m.id, m.objects.map((o) => o.id)));
}

export function moduleMenu(s: Session, t: T, mod: ModuleDef): (MenuEntry & { sectionIndex: number })[] {
  const out: (MenuEntry & { sectionIndex: number })[] = [];
  mod.menu.forEach((g, i) => {
    for (const it of g.items) {
      // stránky správy jen pro správce, objekty jen s právem číst
      const ok = it.href ? !it.href.startsWith("/system/") || (it.href === "/system/modules" ? s.superUser : isAnyAdmin(s)) : can(s.ctx.perms, it.object!, "read");
      if (!ok) continue;
      const o = it.object ? registry.objects.get(it.object)! : null;
      out.push({
        module: mod.id,
        moduleLabel: t(mod.label),
        icon: mod.icon,
        section: t(g.label),
        kind: kindOf(g),
        label: t(it.label ?? o!.labelPlural),
        href: it.href ?? objectHref(o!.id),
        sectionIndex: i,
      });
    }
  });
  // číselné řady modulu do jeho Nastavení (filtr podle Použití)
  if (mod.numberSeqs?.length && mod.id !== "sys" && can(s.ctx.perms, "sys.numberSeq", "read")) {
    const setupIdx = mod.menu.findIndex((g) => kindOf(g) === "setup");
    out.push({
      module: mod.id,
      moduleLabel: t(mod.label),
      icon: mod.icon,
      section: setupIdx >= 0 ? t(mod.menu[setupIdx].label) : t("@SYS:Settings"),
      kind: "setup",
      label: t("@SYS:NumberSeqs"),
      href: `${objectHref("sys.numberSeq")}?filter.usedFor=${encodeURIComponent(`${mod.id}.*`)}`,
      sectionIndex: setupIdx >= 0 ? setupIdx : mod.menu.length,
    });
  }
  return out;
}

/** Celé menu uživatele (pro vyhledávání). */
export function menuIndex(s: Session, t: T): MenuEntry[] {
  return visibleModules(s).flatMap((m) => moduleMenu(s, t, m).map(({ sectionIndex: _i, ...e }) => (void _i, e)));
}
