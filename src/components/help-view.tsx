"use client";

/** Nápověda: přehled návodů (s hledáním) a článek. */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Input, makeStyles, Text, tokens } from "@fluentui/react-components";
import { BookQuestionMark24Regular, Search20Regular } from "@fluentui/react-icons";
import { ActionBar, Crumbs, PageContent } from "./page";

const useStyles = makeStyles({
  wrap: { maxWidth: "880px", display: "flex", flexDirection: "column", gap: "16px" },
  group: { display: "flex", flexDirection: "column", gap: "8px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "10px" },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "14px 16px",
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground1,
    textDecoration: "none",
    ":hover": { border: `1px solid ${tokens.colorBrandStroke1}`, boxShadow: tokens.shadow4 },
  },
  muted: { color: tokens.colorNeutralForeground3 },
  article: {
    maxWidth: "820px",
    padding: "24px 28px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    lineHeight: 1.6,
    fontSize: tokens.fontSizeBase300,
    "& h2": { fontSize: tokens.fontSizeBase500, margin: "22px 0 8px" },
    "& h3": { fontSize: tokens.fontSizeBase400, margin: "18px 0 6px" },
    "& h4": { fontSize: tokens.fontSizeBase300, margin: "14px 0 4px" },
    "& p": { margin: "8px 0" },
    "& ol, & ul": { margin: "8px 0", paddingLeft: "24px" },
    "& li": { margin: "4px 0" },
    "& a": { color: tokens.colorBrandForegroundLink },
    "& code": { fontFamily: tokens.fontFamilyMonospace, backgroundColor: tokens.colorNeutralBackground3, padding: "0 4px", borderRadius: tokens.borderRadiusSmall },
    "& kbd": { fontFamily: tokens.fontFamilyMonospace, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusSmall, padding: "0 4px" },
    "& blockquote": { margin: "12px 0", padding: "10px 14px", borderLeft: `4px solid ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorBrandBackground2, borderRadius: tokens.borderRadiusMedium },
    "& table": { borderCollapse: "collapse", margin: "10px 0", width: "100%" },
    "& th, & td": { border: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px 8px", textAlign: "left", verticalAlign: "top" },
    "& th": { backgroundColor: tokens.colorNeutralBackground3 },
    "& hr": { border: 0, borderTop: `1px solid ${tokens.colorNeutralStroke2}`, margin: "18px 0" },
  },
});

export interface HelpListItem {
  id: string;
  title: string;
  summary: string;
  module: string;
}

export function HelpIndex(p: { crumbs: { label: string; href?: string }[]; groups: { label: string; items: HelpListItem[] }[]; labels: { search: string; intro: string; none: string } }) {
  const s = useStyles();
  const [q, setQ] = useState("");
  const norm = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const groups = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return p.groups.map((g) => ({ ...g, items: g.items.filter((i) => words.every((w) => norm(`${i.title} ${i.summary} ${g.label}`).includes(w))) })).filter((g) => g.items.length);
  }, [q, p.groups]);
  return (
    <>
      <ActionBar>
        <Crumbs items={p.crumbs} />
      </ActionBar>
      <PageContent>
        <div className={s.wrap}>
          <Text className={s.muted}>{p.labels.intro}</Text>
          <Input contentBefore={<Search20Regular />} placeholder={p.labels.search} value={q} onChange={(_, d) => setQ(d.value)} style={{ maxWidth: 420 }} autoFocus />
          {!groups.length && <Text>{p.labels.none}</Text>}
          {groups.map((g) => (
            <div key={g.label} className={s.group}>
              <Text weight="semibold" size={400}>
                {g.label}
              </Text>
              <div className={s.grid}>
                {g.items.map((i) => (
                  <Link key={i.id} href={`/help/${i.id}`} className={s.card}>
                    <Text weight="semibold">
                      <BookQuestionMark24Regular style={{ verticalAlign: "middle", marginRight: 6 }} />
                      {i.title}
                    </Text>
                    <Text size={200} className={s.muted}>
                      {i.summary}
                    </Text>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PageContent>
    </>
  );
}

export function HelpArticle(p: { crumbs: { label: string; href?: string }[]; title: string; html: string }) {
  const s = useStyles();
  return (
    <>
      <ActionBar>
        <Crumbs items={[...p.crumbs, { label: p.title }]} />
      </ActionBar>
      <PageContent>
        <article className={s.article}>
          <h1 style={{ marginTop: 0, fontSize: tokens.fontSizeHero700 }}>{p.title}</h1>
          <div dangerouslySetInnerHTML={{ __html: p.html }} />
        </article>
      </PageContent>
    </>
  );
}
