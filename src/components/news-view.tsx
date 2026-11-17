"use client";

/** Aktuality (deník vývoje): po dnech, hledání, filtr druhu, rozkliknutí popisu a použití. */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Input, makeStyles, Tab, TabList, Text, tokens } from "@fluentui/react-components";
import { ChevronRight16Regular, Search20Regular } from "@fluentui/react-icons";
import { ActionBar, Crumbs, PageContent } from "./page";

const useStyles = makeStyles({
  wrap: { maxWidth: "880px", display: "flex", flexDirection: "column", gap: "14px" },
  muted: { color: tokens.colorNeutralForeground3 },
  day: { display: "flex", flexDirection: "column", gap: "6px" },
  item: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    "& > summary": { listStyle: "none", cursor: "pointer", padding: "10px 14px", display: "flex", gap: "10px", alignItems: "center" },
    "& > summary::-webkit-details-marker": { display: "none" },
    "&[open] > summary svg": { transform: "rotate(90deg)" },
  },
  title: { flex: 1, minWidth: 0 },
  body: {
    padding: "0 16px 12px 40px",
    lineHeight: 1.6,
    fontSize: tokens.fontSizeBase300,
    "& p": { margin: "6px 0" },
    "& ul, & ol": { margin: "6px 0", paddingLeft: "22px" },
    "& h2, & h3, & h4": { fontSize: tokens.fontSizeBase400, margin: "12px 0 4px" },
    "& a": { color: tokens.colorBrandForegroundLink },
    "& code": { fontFamily: tokens.fontFamilyMonospace, backgroundColor: tokens.colorNeutralBackground3, padding: "0 4px", borderRadius: tokens.borderRadiusSmall },
  },
  meta: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
});

export interface NewsItem {
  id: string;
  date: string;
  kind: string;
  area: string;
  title: string;
  issue: string;
  text: string;
  html: string;
}

const COLOR: Record<string, "brand" | "informative" | "warning"> = { feature: "brand", change: "informative", fix: "warning" };

export function NewsView(p: { crumbs: { label: string; href?: string }[]; items: NewsItem[]; kinds: Record<string, string>; logHref: string; labels: { intro: string; search: string; all: string; none: string; log: string } }) {
  const s = useStyles();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const norm = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const days = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    const list = p.items.filter((i) => (kind === "all" || i.kind === kind) && words.every((w) => norm(`${i.title} ${i.area} ${i.issue} ${i.text}`).includes(w)));
    const by = new Map<string, NewsItem[]>();
    for (const i of list) by.set(i.date, [...(by.get(i.date) ?? []), i]);
    return [...by];
  }, [q, kind, p.items]);
  const fmtDay = (d: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "");
  return (
    <>
      <ActionBar>
        <Crumbs items={p.crumbs} />
      </ActionBar>
      <PageContent>
        <div className={s.wrap}>
          <Text className={s.muted}>
            {p.labels.intro} <Link href={p.logHref}>{p.labels.log}</Link>
          </Text>
          <Input contentBefore={<Search20Regular />} placeholder={p.labels.search} value={q} onChange={(_, d) => setQ(d.value)} style={{ maxWidth: 420 }} />
          <TabList selectedValue={kind} onTabSelect={(_, d) => setKind(String(d.value))} size="small">
            <Tab value="all">{p.labels.all}</Tab>
            {Object.entries(p.kinds).map(([k, l]) => (
              <Tab key={k} value={k}>
                {l}
              </Tab>
            ))}
          </TabList>
          {!days.length && <Text>{p.labels.none}</Text>}
          {days.map(([d, items]) => (
            <div key={d} className={s.day}>
              <Text weight="semibold">{fmtDay(d)}</Text>
              {items.map((i) => (
                <details key={i.id} className={s.item} open={!!q.trim() && days.length === 1 && items.length === 1}>
                  <summary>
                    <ChevronRight16Regular />
                    <span className={s.title}>
                      <Text weight="semibold">{i.title}</Text>
                      <span className={s.meta}>
                        <Badge appearance="tint" color={COLOR[i.kind] ?? "informative"} size="small">
                          {p.kinds[i.kind] ?? i.kind}
                        </Badge>
                        {i.area && <span>{i.area}</span>}
                        {i.issue && <span>{i.issue}</span>}
                      </span>
                    </span>
                  </summary>
                  {i.html ? <div className={s.body} dangerouslySetInnerHTML={{ __html: i.html }} /> : <div className={s.body}>{i.title}</div>}
                </details>
              ))}
            </div>
          ))}
        </div>
      </PageContent>
    </>
  );
}
