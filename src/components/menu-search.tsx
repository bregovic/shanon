"use client";

/**
 * Hledání v menu: pole s výsledky pod ním, šipky + Enter, Esc zavře.
 * V hlavičce zkratka Ctrl+K (nebo /).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input, makeStyles, mergeClasses, Text, tokens } from "@fluentui/react-components";
import { Search24Regular } from "@fluentui/react-icons";
import { searchMenu, type MenuHit } from "@/lib/menu-search";
import { ModuleIcon } from "./icons";

const useStyles = makeStyles({
  root: { position: "relative" },
  list: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    right: 0,
    minWidth: "320px",
    zIndex: 1000,
    maxHeight: "420px",
    overflowY: "auto",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow16,
    padding: "4px",
  },
  inline: { position: "static", boxShadow: "none", maxHeight: "none", marginTop: "8px" },
  hit: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "8px 10px",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
  },
  active: { backgroundColor: tokens.colorNeutralBackground1Selected },
  icon: { color: tokens.colorBrandForeground1, display: "grid", placeItems: "center" },
  path: { color: tokens.colorNeutralForeground3 },
  empty: { padding: "10px", color: tokens.colorNeutralForeground3 },
});

export function MenuSearch({
  menu,
  placeholder,
  noResults,
  shortcut = false,
  inline = false,
  autoFocus = false,
  size = "medium",
}: {
  menu: MenuHit[];
  placeholder: string;
  noResults: string;
  /** Ctrl+K a / zaměří pole (hlavička) */
  shortcut?: boolean;
  /** výsledky v toku stránky (přehled), ne v plovoucím seznamu */
  inline?: boolean;
  autoFocus?: boolean;
  size?: "medium" | "large";
}) {
  const st = useStyles();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => searchMenu(menu, q), [menu, q]);

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);

  const go = (href: string) => {
    setQ("");
    setOpen(false);
    input.current?.blur();
    router.push(href);
  };

  return (
    <div className={st.root}>
      <Input
        ref={input}
        value={q}
        size={size}
        autoFocus={autoFocus}
        contentBefore={<Search24Regular />}
        placeholder={placeholder}
        aria-label={placeholder}
        style={{ width: "100%" }}
        onChange={(_, d) => {
          setQ(d.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && hits[active]) {
            e.preventDefault();
            go(hits[active].href);
          } else if (e.key === "Escape") {
            setQ("");
            setOpen(false);
            input.current?.blur();
          }
        }}
      />
      {open && q.trim() && (
        <div className={mergeClasses(st.list, inline && st.inline)} role="listbox">
          {hits.length ? (
            hits.map((h, i) => (
              <div
                key={h.href}
                role="option"
                aria-selected={i === active}
                className={mergeClasses(st.hit, i === active && st.active)}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(h.href);
                }}
              >
                <span className={st.icon}>
                  <ModuleIcon name={h.icon} />
                </span>
                <span>
                  <Text weight="semibold">{h.label}</Text>
                  <br />
                  <Text size={200} className={st.path}>
                    {h.moduleLabel} › {h.section}
                  </Text>
                </span>
              </div>
            ))
          ) : (
            <div className={st.empty}>{noResults}</div>
          )}
        </div>
      )}
    </div>
  );
}
