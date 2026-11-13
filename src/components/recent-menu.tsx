"use client";

/**
 * Nedávné: posledních 5 otevřených funkcí z menu (seznamy, reporty, funkce).
 * Pamatuje si je prohlížeč (pohodlí uživatele, ne data aplikace).
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Tooltip } from "@fluentui/react-components";
import { History24Regular } from "@fluentui/react-icons";
import type { MenuHit } from "@/lib/menu-search";

const KEY = "shanon:recent";
const MAX = 5;

type Recent = { href: string; label: string; module: string };

function load(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function RecentMenu({ menu, labels }: { menu: MenuHit[]; labels: { title: string; empty: string } }) {
  const path = usePathname();
  const router = useRouter();
  const [items, setItems] = useState<Recent[]>([]);

  // otevřená funkce z menu → na začátek seznamu
  useEffect(() => {
    const hit = menu.find((m) => m.href.split("?")[0] === path);
    const list = load();
    if (hit) {
      const next = [{ href: hit.href, label: hit.label, module: hit.moduleLabel }, ...list.filter((r) => r.href !== hit.href)].slice(0, MAX);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* bez úložiště jen pro tuto stránku */
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems(next);
    } else setItems(list);
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
