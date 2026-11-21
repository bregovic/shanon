"use client";

/**
 * Nedávné: posledních 10 otevřených funkcí z menu (seznamy, reporty, funkce) — v databázi u uživatele
 * (stejné ve všech oknech a zařízeních), starší se mažou (`touchRecentAction`).
 */
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Tooltip } from "@fluentui/react-components";
import { History24Regular } from "@fluentui/react-icons";
import type { MenuHit } from "@/lib/menu-search";
import { recentAction, touchRecentAction } from "@/app/actions";

type Recent = { href: string; label: string; module: string };

export function RecentMenu({ menu, labels }: { menu: MenuHit[]; labels: { title: string; empty: string } }) {
  const path = usePathname();
  const router = useRouter();
  const [items, setItems] = useState<Recent[]>([]);
  const last = useRef<string | null>(null);

  // otevřená funkce z menu → na začátek seznamu (zápis jen při změně stránky)
  useEffect(() => {
    const hit = menu.find((m) => m.href.split("?")[0] === path);
    const key = hit?.href ?? "";
    if (last.current === key) return;
    last.current = key;
    (hit ? touchRecentAction(hit.href, hit.label, hit.moduleLabel) : recentAction()).then(setItems).catch(() => undefined);
  }, [path, menu]);

  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={labels.title} relationship="label">
          <Button appearance="subtle" icon={<History24Regular />} aria-label={labels.title} />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {items.length === 0 && <MenuItem disabled>{labels.empty}</MenuItem>}
          {items.map((r) => (
            <MenuItem key={r.href} secondaryContent={r.module} onClick={() => router.push(r.href)}>
              {r.label}
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
