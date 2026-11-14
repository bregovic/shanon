"use client";

/** Zvoneček v hlavičce: upozornění firmy, nepřečtená s počtem, kontrola každou minutu. */
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, CounterBadge, makeStyles, Popover, PopoverSurface, PopoverTrigger, Switch, Text, tokens, Tooltip } from "@fluentui/react-components";
import { Alert24Regular, CheckmarkCircle20Regular, ErrorCircle20Regular, Info20Regular, Warning20Regular } from "@fluentui/react-icons";
import { markNoticesReadAction, noticesAction } from "@/app/actions";
import type { NoticeView } from "@/server/notices";

const useStyles = makeStyles({
  wrap: { position: "relative", display: "inline-flex" },
  badge: { position: "absolute", top: "0", right: "0", pointerEvents: "none" },
  surface: { width: "380px", maxWidth: "calc(100vw - 32px)", padding: "0" },
  head: { display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  list: { maxHeight: "60vh", overflowY: "auto" },
  item: {
    display: "flex",
    gap: "10px",
    padding: "10px 14px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  unread: { backgroundColor: tokens.colorBrandBackground2 },
  text: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
  empty: { padding: "18px 14px", color: tokens.colorNeutralForeground3 },
});

const ICON: Record<string, React.ReactNode> = {
  error: <ErrorCircle20Regular style={{ color: tokens.colorPaletteRedForeground1 }} />,
  warning: <Warning20Regular style={{ color: tokens.colorPaletteDarkOrangeForeground1 }} />,
  info: <Info20Regular style={{ color: tokens.colorBrandForeground1 }} />,
};

export function NotificationBell({ labels, lang }: { labels: { title: string; empty: string; allRead: string; showRead: string }; lang: string }) {
  const s = useStyles();
  const router = useRouter();
  const [items, setItems] = useState<NoticeView[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [showRead, setShowRead] = useState(false);
  const [, start] = useTransition();

  const load = useCallback(() => {
    noticesAction()
      .then((r) => {
        setItems(r.items);
        setUnread(r.unread);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const markRead = (ids: string[]) =>
    start(async () => {
      if (!ids.length) return;
      setItems((x) => x.map((i) => (ids.includes(i.id) ? { ...i, read: true } : i)));
      setUnread((u) => Math.max(0, u - ids.length));
      await markNoticesReadAction(ids);
      load();
    });

  const shown = items.filter((i) => showRead || !i.read);
  const fmt = (at: string) => new Date(at).toLocaleString(lang === "en" ? "en-GB" : "cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <Popover open={open} onOpenChange={(_, d) => (setOpen(d.open), d.open && load())} positioning="below-end" trapFocus>
      <PopoverTrigger disableButtonEnhancement>
        <span className={s.wrap}>
          <Tooltip content={labels.title} relationship="label">
            <Button appearance="subtle" icon={<Alert24Regular />} aria-label={`${labels.title}${unread ? ` (${unread})` : ""}`} />
          </Tooltip>
          {unread > 0 && <CounterBadge className={s.badge} count={unread} size="small" color="danger" overflowCount={9} />}
        </span>
      </PopoverTrigger>
      <PopoverSurface className={s.surface}>
        <div className={s.head}>
          <Text weight="semibold" style={{ flex: 1 }}>
            {labels.title}
          </Text>
          <Switch label={labels.showRead} checked={showRead} onChange={(_, d) => setShowRead(d.checked)} />
        </div>
        <div className={s.list}>
          {!shown.length && <div className={s.empty}>{labels.empty}</div>}
          {shown.map((n) => (
            <div
              key={n.id}
              role="button"
              tabIndex={0}
              className={`${s.item} ${n.read ? "" : s.unread}`}
              onClick={() => {
                if (!n.read) markRead([n.id]);
                if (n.href) {
                  setOpen(false);
                  router.push(n.href);
                }
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLElement).click()}
            >
              {ICON[n.kind] ?? ICON.info}
              <div className={s.text}>
                <Text weight={n.read ? "regular" : "semibold"}>{n.text}</Text>
                {n.message && (
                  <Text size={200} className={s.muted}>
                    {n.message}
                  </Text>
                )}
                <Text size={100} className={s.muted}>
                  {fmt(n.at)}
                </Text>
              </div>
            </div>
          ))}
        </div>
        {unread > 0 && (
          <div className={s.head} style={{ borderBottom: 0, justifyContent: "flex-end" }}>
            <Button size="small" appearance="subtle" icon={<CheckmarkCircle20Regular />} onClick={() => markRead(items.filter((i) => !i.read).map((i) => i.id))}>
              {labels.allRead}
            </Button>
          </div>
        )}
      </PopoverSurface>
    </Popover>
  );
}
