"use client";

/** Oblíbené stránky a pohledy uživatele: kontext, hvězdička, menu ve složkách v hlavičce a jejich úprava. */
import { createContext, useContext, useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Combobox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  makeStyles,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Option,
  tokens,
  Tooltip,
} from "@fluentui/react-components";
import { Delete24Regular, Edit24Regular, Folder24Regular, Star24Filled, Star24Regular } from "@fluentui/react-icons";
import { saveFavoriteAction, toggleFavoriteAction, updateFavoritesAction } from "@/app/actions";

export interface Favorite {
  href: string;
  label: string;
  folder?: string | null;
}

interface Labels {
  add: string;
  remove: string;
  title: string;
  empty: string;
  manage: string;
  name: string;
  folder: string;
  save: string;
  cancel: string;
  removeItem: string;
}

interface Ctx {
  favorites: Favorite[];
  folders: string[];
  toggle: (href: string, label: string) => void;
  save: (href: string, label: string, folder: string) => Promise<void>;
  labels: Labels;
}

const FavoritesContext = createContext<Ctx | null>(null);

export function useFavorites() {
  return useContext(FavoritesContext);
}

export function FavoritesProvider({ favorites, labels, children }: { favorites: Favorite[]; labels: Labels; children: React.ReactNode }) {
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
  const save = (href: string, label: string, folder: string) => saveFavoriteAction(href, label, folder);
  const folders = useMemo(() => [...new Set(favorites.map((f) => f.folder).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "cs")), [favorites]);
  return <FavoritesContext.Provider value={{ favorites: optimistic, folders, toggle, save, labels }}>{children}</FavoritesContext.Provider>;
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

/** Výběr složky: existující nebo nová (napsaná). */
export function FolderPicker({ value, onChange, label, hint }: { value: string; onChange: (v: string) => void; label: string; hint?: string }) {
  const ctx = useContext(FavoritesContext);
  const folders = ctx?.folders ?? [];
  return (
    <Field label={label} hint={hint}>
      <Combobox freeform value={value} onChange={(e) => onChange(e.target.value)} onOptionSelect={(_, d) => onChange(d.optionText ?? "")}>
        {folders.map((f) => (
          <Option key={f}>{f}</Option>
        ))}
      </Combobox>
    </Field>
  );
}

const star = <Star24Filled style={{ color: tokens.colorPaletteMarigoldBorderActive }} />;

export function FavoritesMenu() {
  const ctx = useContext(FavoritesContext);
  const router = useRouter();
  const [manage, setManage] = useState(false);
  if (!ctx) return null;
  const loose = ctx.favorites.filter((f) => !f.folder);
  const item = (f: Favorite) => (
    <MenuItem key={f.href} icon={star} onClick={() => router.push(f.href)}>
      {f.label}
    </MenuItem>
  );
  return (
    <>
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Tooltip content={ctx.labels.title} relationship="label">
            <Button appearance="subtle" icon={<Star24Regular />} aria-label={ctx.labels.title} />
          </Tooltip>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            {ctx.favorites.length === 0 && <MenuItem disabled>{ctx.labels.empty}</MenuItem>}
            {ctx.folders.map((folder) => (
              <Menu key={folder}>
                <MenuTrigger disableButtonEnhancement>
                  <MenuItem icon={<Folder24Regular />}>{folder}</MenuItem>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>{ctx.favorites.filter((f) => f.folder === folder).map(item)}</MenuList>
                </MenuPopover>
              </Menu>
            ))}
            {loose.map(item)}
            {ctx.favorites.length > 0 && (
              <>
                <MenuDivider />
                <MenuItem icon={<Edit24Regular />} onClick={() => setManage(true)}>
                  {ctx.labels.manage}
                </MenuItem>
              </>
            )}
          </MenuList>
        </MenuPopover>
      </Menu>
      {manage && <ManageFavorites onClose={() => setManage(false)} />}
    </>
  );
}

const useStyles = makeStyles({
  row: { display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) auto", gap: "8px", alignItems: "center", marginBottom: "8px" },
  head: { display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) auto", gap: "8px", marginBottom: "4px", fontWeight: 600 },
  removed: { opacity: 0.45, textDecoration: "line-through" },
});

/** Úprava oblíbených: název, složka, odebrání — uloží se najednou. */
function ManageFavorites({ onClose }: { onClose: () => void }) {
  const ctx = useContext(FavoritesContext)!;
  const st = useStyles();
  const router = useRouter();
  const [rows, setRows] = useState(() => ctx.favorites.map((f) => ({ href: f.href, label: f.label, folder: f.folder ?? "", remove: false })));
  const [busy, start] = useTransition();
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 720 }}>
        <DialogBody>
          <DialogTitle>{ctx.labels.manage.replace(/…$/, "")}</DialogTitle>
          <DialogContent>
            <div className={st.head}>
              <span>{ctx.labels.name}</span>
              <span>{ctx.labels.folder}</span>
              <span />
            </div>
            {rows.map((r, i) => (
              <div key={r.href} className={`${st.row} ${r.remove ? st.removed : ""}`}>
                <Input value={r.label} disabled={r.remove} onChange={(_, d) => set(i, { label: d.value })} aria-label={ctx.labels.name} />
                <Input value={r.folder} disabled={r.remove} onChange={(_, d) => set(i, { folder: d.value })} aria-label={ctx.labels.folder} list="fav-folders" />
                <Tooltip content={ctx.labels.removeItem} relationship="label">
                  <Button appearance="subtle" icon={<Delete24Regular />} aria-pressed={r.remove} onClick={() => set(i, { remove: !r.remove })} />
                </Tooltip>
              </div>
            ))}
            <datalist id="fav-folders">
              {ctx.folders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{ctx.labels.cancel}</Button>
            <Button
              appearance="primary"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  await updateFavoritesAction(rows);
                  router.refresh();
                  onClose();
                })
              }
            >
              {ctx.labels.save}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
