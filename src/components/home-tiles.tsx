"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge, Card, CardHeader, makeStyles, Text, tokens } from "@fluentui/react-components";
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
  tasks: { maxWidth: "900px", marginBottom: "24px", padding: "12px 16px" },
  taskHead: { display: "flex", alignItems: "baseline", gap: "12px", flexWrap: "wrap", marginBottom: "6px" },
  taskRow: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    gap: "4px 10px",
    alignItems: "center",
    padding: "7px 0",
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  taskTitle: { color: tokens.colorNeutralForeground1, textDecoration: "none", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" },
  taskSub: { color: tokens.colorNeutralForeground3, fontSize: "12px" },
  overdue: { color: tokens.colorPaletteRedForeground1 },
  more: { color: tokens.colorBrandForeground1, textDecoration: "none", fontSize: "13px" },
});

type TaskLabels = { title: string; empty: string; unassigned: string; all: string; overdue: string };

/** Moje úkoly — otevřené pracovní položky přihlášeného (klik = záznam, štítek = úkol). */
function TaskPanel({ tasks, L }: { tasks: MyTasks; L: TaskLabels }) {
  const s = useStyles();
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("cs-CZ");
  return (
    <Card className={s.tasks}>
      <div className={s.taskHead}>
        <Text weight="semibold" size={400}>
          {L.title} ({tasks.total})
        </Text>
        {tasks.unassigned ? (
          <Link className={s.more} href={'/wf/workItem?filter.assignedTo=""&filter.status=open'}>
            {L.unassigned} ({tasks.unassigned})
          </Link>
        ) : null}
        <Link className={s.more} href="/wf/workItem?filter.assignedTo=me&filter.status=open">
          {L.all}
        </Link>
      </div>
      {!tasks.items.length && <Text size={200}>{L.empty}</Text>}
      {tasks.items.map((w) => (
        <div key={w.id} className={s.taskRow}>
          <Link href={w.taskHref} style={{ textDecoration: "none" }}>
            <Badge appearance="tint" color={(w.kindColor as "brand") ?? "informative"}>
              {w.kindLabel}
            </Badge>
          </Link>
          <Link className={s.taskTitle} href={w.href}>
            {w.title}
            {w.refTitle ? <span className={s.taskSub}> · {w.refTitle}</span> : null}
          </Link>
          {w.due ? (
            <span className={`${s.taskSub} ${w.overdue ? s.overdue : ""}`}>
              {fmt(w.due)}
              {w.overdue ? ` · ${L.overdue}` : ""}
            </span>
          ) : (
            <span />
          )}
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
