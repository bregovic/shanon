"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTransition } from "react";
import { Badge, Button, Card, CardHeader, makeStyles, mergeClasses, Text, tokens } from "@fluentui/react-components";
import { Checkmark20Regular, CheckmarkCircle20Regular, DismissCircle20Regular, Open20Regular } from "@fluentui/react-icons";
import { workflowItemAction } from "@/app/actions";
import { toast } from "./toast";
import type { MyTasks } from "@/server/work-items";
import { ModuleIcon } from "./icons";
import { MenuSearch } from "./menu-search";
import type { MenuHit } from "@/lib/menu-search";
import { ActionBar, Crumbs, PageContent } from "./page";

const useStyles = makeStyles({
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "16px" },
  icon: {
    display: "grid",
    placeItems: "center",
    width: "40px",
    height: "40px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
  },
  tasks: { maxWidth: "980px", marginBottom: "24px", padding: "12px 16px" },
  taskHead: { display: "flex", alignItems: "center", gap: "8px 12px", flexWrap: "wrap", marginBottom: "8px" },
  taskRow: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    gridTemplateAreas: '"kind main side"',
    gap: "4px 12px",
    alignItems: "center",
    padding: "8px 8px 8px 10px",
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    borderLeft: "3px solid transparent",
    "@media (max-width: 640px)": { gridTemplateColumns: "auto minmax(0, 1fr)", gridTemplateAreas: '"kind main" "side side"' },
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  rowOverdue: { borderLeftColor: tokens.colorPaletteRedBorder2 },
  kindCell: { gridArea: "kind" },
  mainCell: { gridArea: "main", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" },
  sideCell: { gridArea: "side", display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap" },
  taskTitle: { color: tokens.colorNeutralForeground1, textDecoration: "none", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ":hover": { textDecoration: "underline" } },
  taskSub: { color: tokens.colorNeutralForeground3, fontSize: "12px" },
  taskDesc: { color: tokens.colorNeutralForeground2, fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  overdue: { color: tokens.colorPaletteRedForeground1, fontWeight: 600 },
  more: { color: tokens.colorBrandForeground1, textDecoration: "none", fontSize: "13px" },
  empty: { display: "flex", alignItems: "center", gap: "8px", color: tokens.colorNeutralForeground3, padding: "8px 0" },
});

type TaskLabels = { title: string; empty: string; unassigned: string; all: string; overdue: string; approve: string; reject: string; done: string; open: string; today: string; daysAgo: string; due: string; overdueCount: string };

/**
 * Moje úkoly — otevřené pracovní položky přihlášeného: po termínu nahoře (červený okraj), druh, název (klik = záznam),
 * co chybí, termín a stáří; rychle Schválit / Hotovo (bez komentáře), Zamítnout a Doplnit údaje otevřou záznam
 * (komentář a úprava v proužku workflow).
 */
function TaskPanel({ tasks, L }: { tasks: MyTasks; L: TaskLabels }) {
  const s = useStyles();
  const router = useRouter();
  const [busy, start] = useTransition();
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("cs-CZ");
  const act = (w: MyTasks["items"][number], action: "approve" | "done") =>
    start(async () => {
      const r = await workflowItemAction(w.id, action, null, w.refObject ?? "wf.workItem", w.refId ?? w.id);
      if (!r.ok) toast(r.message, "warning");
      router.refresh();
    });
  return (
    <Card className={s.tasks}>
      <div className={s.taskHead}>
        <Text weight="semibold" size={400}>
          {L.title} ({tasks.total})
        </Text>
        {tasks.byKind.map((k) => (
          <Badge key={k.kind} appearance="tint" color={(k.color as "brand") ?? "informative"}>
            {k.label} {k.count}
          </Badge>
        ))}
        {tasks.overdue > 0 && (
          <Badge appearance="filled" color="danger">
            {L.overdueCount.replace("{n}", String(tasks.overdue))}
          </Badge>
        )}
        <span style={{ flexGrow: 1 }} />
        {tasks.unassigned ? (
          <Link className={s.more} href={'/wf/workItem?filter.assignedTo=""&filter.status=open'}>
            {L.unassigned} ({tasks.unassigned})
          </Link>
        ) : null}
        <Link className={s.more} href="/wf/workItem?filter.assignedTo=me&filter.status=open">
          {L.all}
        </Link>
      </div>
      {!tasks.items.length && (
        <div className={s.empty}>
          <CheckmarkCircle20Regular /> <Text size={200}>{L.empty}</Text>
        </div>
      )}
      {tasks.items.map((w) => (
        <div key={w.id} className={mergeClasses(s.taskRow, w.overdue && s.rowOverdue)}>
          <Link href={w.taskHref} className={s.kindCell} style={{ textDecoration: "none" }} title={L.open}>
            <Badge appearance="tint" color={(w.kindColor as "brand") ?? "informative"}>
              {w.kindLabel}
            </Badge>
          </Link>
          <div className={s.mainCell}>
            <Link className={s.taskTitle} href={w.href} title={w.title}>
              {w.title}
              {w.refTitle ? <span className={s.taskSub}> · {w.refTitle}</span> : null}
            </Link>
            {w.description && (
              <span className={s.taskDesc} title={w.description}>
                {w.description}
              </span>
            )}
          </div>
          <div className={s.sideCell}>
            <span className={s.taskSub}>
              {w.due ? <span className={w.overdue ? s.overdue : undefined}>{`${L.due} ${fmt(w.due)}${w.overdue ? ` · ${L.overdue}` : ""}`}</span> : null}
              {w.due ? " · " : ""}
              {w.ageDays === 0 ? L.today : L.daysAgo.replace("{n}", String(w.ageDays))}
            </span>
            {w.kind === "approval" ? (
              <>
                <Button size="small" appearance="primary" icon={<CheckmarkCircle20Regular />} disabled={busy} onClick={() => act(w, "approve")}>
                  {L.approve}
                </Button>
                <Button size="small" icon={<DismissCircle20Regular />} onClick={() => router.push(w.href)}>
                  {L.reject}
                </Button>
              </>
            ) : w.kind === "fix" ? (
              <Button size="small" appearance="primary" icon={<Open20Regular />} onClick={() => router.push(w.href)}>
                {L.open}
              </Button>
            ) : (
              <Button size="small" icon={<Checkmark20Regular />} disabled={busy} onClick={() => act(w, "done")}>
                {L.done}
              </Button>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}

export function HomeTiles({
  title,
  modules,
  menu,
  labels,
  tasks,
  taskLabels,
}: {
  tasks?: MyTasks | null;
  taskLabels?: TaskLabels;
  title: string;
  modules: { id: string; label: string; description: string; icon: string }[];
  menu: MenuHit[];
  labels: { search: string; noResults: string; results: string };
}) {
  const s = useStyles();
  const router = useRouter();
  return (
    <>
      <ActionBar>
        <Crumbs items={[{ label: title }]} />
      </ActionBar>
      <PageContent>
        {tasks && taskLabels && <TaskPanel tasks={tasks} L={taskLabels} />}
        <div style={{ maxWidth: 640, marginBottom: 24 }}>
          <MenuSearch menu={menu} placeholder={labels.search} noResults={labels.noResults} inline autoFocus size="large" />
        </div>
        <div className={s.grid}>
          {modules.map((m) => (
            <Card key={m.id} onClick={() => router.push(`/${m.id}`)} style={{ cursor: "pointer" }}>
              <CardHeader
                image={
                  <div className={s.icon}>
                    <ModuleIcon name={m.icon} />
                  </div>
                }
                header={<Text weight="semibold">{m.label}</Text>}
                description={<Text size={200}>{m.description}</Text>}
              />
            </Card>
          ))}
        </div>
      </PageContent>
    </>
  );
}
