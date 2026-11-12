"use client";

/**
 * Pracovní plocha modulu (převzatá ze staré verze): sloupce Formuláře /
 * Nastavení, v nich sbalovací sekce s odkazy.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, makeStyles, Text, tokens, ToolbarDivider } from "@fluentui/react-components";
import { ChevronDown16Regular, ChevronDown24Regular, ChevronRight16Regular, ChevronUp24Regular } from "@fluentui/react-icons";
import { ActionBar, Crumbs, PageContent, Spacer } from "./page";

export interface WorkspaceColumn {
  title: string;
  sections: { id: string; title: string; items: { label: string; href: string }[] }[];
}

const useStyles = makeStyles({
  columns: {
    columnWidth: "300px",
    columnGap: "32px",
  },
  column: { breakInside: "avoid", marginBottom: "32px", display: "inline-block", width: "100%" },
  columnTitle: {
    display: "block",
    marginBottom: "16px",
    color: tokens.colorNeutralForeground2,
    textTransform: "uppercase",
    fontSize: "13px",
    letterSpacing: "0.5px",
  },
  sectionHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 0",
    marginBottom: "8px",
    cursor: "pointer",
    userSelect: "none",
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
  },
  item: {
    display: "flex",
    alignItems: "center",
    padding: "12px 16px",
    marginBottom: "2px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    fontWeight: tokens.fontWeightMedium,
    transition: "all 0.15s",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      borderTopColor: tokens.colorBrandStroke1,
      borderRightColor: tokens.colorBrandStroke1,
      borderBottomColor: tokens.colorBrandStroke1,
      borderLeftColor: tokens.colorBrandStroke1,
      color: tokens.colorBrandForeground1,
    },
  },
});

export function ModuleWorkspace({
  crumbs,
  columns,
  labels,
}: {
  crumbs: { label: string; href?: string }[];
  columns: WorkspaceColumn[];
  labels: { expandAll: string; collapseAll: string };
}) {
  const s = useStyles();
  const router = useRouter();
  const all = columns.flatMap((c) => c.sections.map((x) => x.id));
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(all));
  const toggle = (id: string) =>
    setOpenIds((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <ActionBar>
        <Crumbs items={crumbs} />
        <Spacer />
        <Button appearance="subtle" icon={<ChevronDown24Regular />} onClick={() => setOpenIds(new Set(all))}>
          {labels.expandAll}
        </Button>
        <Button appearance="subtle" icon={<ChevronUp24Regular />} onClick={() => setOpenIds(new Set())}>
          {labels.collapseAll}
        </Button>
        <ToolbarDivider />
      </ActionBar>
      <PageContent>
        <div className={s.columns}>
          {columns.map((c) => (
            <div key={c.title} className={s.column}>
              <Text weight="bold" className={s.columnTitle}>
                {c.title}
              </Text>
              {c.sections.map((sec) => (
                <div key={sec.id} style={{ marginBottom: 16 }}>
                  <div className={s.sectionHead} onClick={() => toggle(sec.id)}>
                    <Text weight="semibold" size={400}>
                      {sec.title}
                    </Text>
                    {openIds.has(sec.id) ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                  </div>
                  {openIds.has(sec.id) &&
                    sec.items.map((it) => (
                      <div
                        key={it.href}
                        className={s.item}
                        role="link"
                        tabIndex={0}
                        onClick={() => router.push(it.href)}
                        onKeyDown={(e) => e.key === "Enter" && router.push(it.href)}
                      >
                        {it.label}
                      </div>
                    ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </PageContent>
    </>
  );
}
