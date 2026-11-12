"use client";

/** Oblíbené stránky uživatele: kontext, hvězdička a menu v hlavičce. */
import { createContext, useContext, useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, tokens, Tooltip } from "@fluentui/react-components";
import { Star24Filled, Star24Regular } from "@fluentui/react-icons";
import { toggleFavoriteAction } from "@/app/actions";

export interface Favorite {
  href: string;
  label: string;
}

interface Ctx {
  favorites: Favorite[];
  toggle: (href: string, label: string) => void;
  labels: { add: string; remove: string; title: string; empty: string };
}

const FavoritesContext = createContext<Ctx | null>(null);

export function FavoritesProvider({
  favorites,
  labels,
  children,
}: {
  favorites: Favorite[];
  labels: Ctx["labels"];
  children: React.ReactNode;
}) {
  const [, start] = useTransition();
  // okamžitá odezva hvězdičky, server potvrdí revalidací
  const [optimistic, apply] = useOptimistic(favorites, (cur, f: Favorite) =>
    cur.some((x) => x.href === f.href) ? cur.filter((x) => x.href !== f.href) : [...cur, f],
  );
  const toggle = (href: string, label: string) =>
    start(async () => {
      apply({ href, label });
      await toggleFavoriteAction(href, label);
    });
  return <FavoritesContext.Provider value={{ favorites: optimistic, toggle, labels }}>{children}</FavoritesContext.Provider>;
}

export function FavoriteStar({ href, label, size = "medium" }: { href: string; label: string; size?: "small" | "medium" }) {
  const ctx = useContext(FavoritesContext);
  if (!ctx) return null;
  const on = ctx.favorites.some((f) => f.href === href);
  return (
    <Tooltip content={on ? ctx.labels.remove : ctx.labels.add} relationship="label">
      <Button
        appearance="transparent"
        size={size}
        icon={on ? <Star24Filled style={{ color: tokens.colorPaletteMarigoldBorderActive }} /> : <Star24Regular />}
        onClick={(e) => {
          e.stopPropagation();
          ctx.toggle(href, label);
        }}
      />
    </Tooltip>
  );
}

export function FavoritesMenu() {
  const ctx = useContext(FavoritesContext);
  const router = useRouter();
  if (!ctx) return null;
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={ctx.labels.title} relationship="label">
          <Button appearance="subtle" icon={<Star24Regular />} aria-label={ctx.labels.title} />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {ctx.favorites.length === 0 && <MenuItem disabled>{ctx.labels.empty}</MenuItem>}
          {ctx.favorites.map((f) => (
            <MenuItem key={f.href} icon={<Star24Filled style={{ color: tokens.colorPaletteMarigoldBorderActive }} />} onClick={() => router.push(f.href)}>
              {f.label}
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
