"use client";

/** Zapínání modulů a rozšíření (obdoba konfiguračních klíčů v AX). */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, makeStyles, Switch, Text, tokens } from "@fluentui/react-components";
import { toggleExtensionAction, toggleModuleAction } from "@/app/actions";
import { ModuleIcon } from "./icons";
import { ActionBar, Crumbs, PageContent } from "./page";

export interface FeatureRow {
  kind: "module" | "extension";
  id: string;
  icon: string;
  label: string;
  description: string;
  enabled: boolean;
  canToggle: boolean;
  notes: string[];
}

const useStyles = makeStyles({
  list: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    maxWidth: "900px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    padding: "16px 20px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    ":last-child": { borderBottom: "none" },
  },
  icon: {
    display: "grid",
    placeItems: "center",
    width: "36px",
    height: "36px",
    flexShrink: 0,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
  },
  text: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" },
  note: { color: tokens.colorNeutralForeground3 },
  title: { display: "block", marginBottom: "8px", textTransform: "uppercase", fontSize: "13px", color: tokens.colorNeutralForeground2 },
});

export function FeatureList({
  crumbs,
  sections,
  labels,
}: {
  crumbs: { label: string; href?: string }[];
  sections: { title: string; rows: FeatureRow[] }[];
  labels: { enable: string; disable: string; enabled: string };
}) {
  const s = useStyles();
  const router = useRouter();
  const [busy, start] = useTransition();

  const toggle = (r: FeatureRow) =>
    start(async () => {
      const fd = new FormData();
      fd.set(r.kind, r.id);
      fd.set("enable", r.enabled ? "0" : "1");
      await (r.kind === "module" ? toggleModuleAction(fd) : toggleExtensionAction(fd));
      router.refresh();
    });

  return (
    <>
      <ActionBar>
        <Crumbs items={crumbs} />
      </ActionBar>
      <PageContent>
        {sections.map((sec) => (
          <div key={sec.title}>
            <Text weight="bold" className={s.title}>
              {sec.title}
            </Text>
            <div className={s.list}>
              {sec.rows.map((r) => (
                <div key={r.id} className={s.row}>
                  <div className={s.icon}>
                    <ModuleIcon name={r.icon} />
                  </div>
                  <div className={s.text}>
                    <Text weight="semibold">
                      {r.label}{" "}
                      {r.enabled && (
                        <Badge appearance="tint" color="success" size="small">
                          {labels.enabled}
                        </Badge>
                      )}
                    </Text>
                    <Text size={200}>{r.description}</Text>
                    {r.notes.map((n) => (
                      <Text key={n} size={200} className={s.note}>
                        {n}
                      </Text>
                    ))}
                  </div>
                  {r.canToggle ? (
                    <Switch
                      checked={r.enabled}
                      disabled={busy}
                      aria-label={r.enabled ? labels.disable : labels.enable}
                      onChange={() => toggle(r)}
                    />
                  ) : (
                    <Button disabled appearance="transparent">
                      {r.enabled ? labels.enabled : ""}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </PageContent>
    </>
  );
}
