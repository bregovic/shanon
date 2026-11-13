"use client";

/** Integrace → Testovací prostředí: zapnout / vypnout testovací napojení a data. */
import { useState, useTransition } from "react";
import { Badge, Button, makeStyles, MessageBar, MessageBarBody, Text, tokens } from "@fluentui/react-components";
import { BeakerOffRegular, Beaker24Regular } from "@fluentui/react-icons";
import { intTestEnvAction } from "@/app/actions";
import type { TestEnvState } from "@/modules/int/test-env";
import { ActionBar, Crumbs, PageContent, Spacer } from "./page";

const useStyles = makeStyles({
  card: {
    maxWidth: "900px",
    padding: "20px 24px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  list: { margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "4px" },
  muted: { color: tokens.colorNeutralForeground3 },
  row: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
});

export function TestEnvView({
  crumbs,
  initial,
  items,
  labels,
}: {
  crumbs: { label: string; href?: string }[];
  initial: TestEnvState;
  items: string[];
  labels: Record<"intro" | "will" | "on" | "off" | "active" | "inactive" | "paused" | "real" | "connections", string>;
}) {
  const s = useStyles();
  const [state, setState] = useState(initial);
  const [err, setErr] = useState<string>();
  const [busy, start] = useTransition();
  const run = (on: boolean) =>
    start(async () => {
      const r = await intTestEnvAction(on);
      if (r.ok) {
        setState(r.data);
        setErr(undefined);
      } else setErr(r.message);
    });
  return (
    <>
      <ActionBar>
        <Crumbs items={crumbs} />
        <Spacer />
        {state.active ? (
          <Button icon={<BeakerOffRegular />} disabled={busy} onClick={() => run(false)}>
            {labels.off}
          </Button>
        ) : (
          <Button appearance="primary" icon={<Beaker24Regular />} disabled={busy} onClick={() => run(true)}>
            {labels.on}
          </Button>
        )}
      </ActionBar>
      <PageContent>
        {err && (
          <MessageBar intent="error">
            <MessageBarBody>{err}</MessageBarBody>
          </MessageBar>
        )}
        <div className={s.card}>
          <div className={s.row}>
            <Badge appearance="tint" color={state.active ? "warning" : "subtle"} size="large">
              {state.active ? labels.active : labels.inactive}
            </Badge>
          </div>
          <Text>{labels.intro}</Text>
          <Text weight="semibold">{labels.will}</Text>
          <ul className={s.list}>
            {items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
          {state.connections.length > 0 && (
            <>
              <Text weight="semibold">{labels.connections}</Text>
              <div className={s.row}>
                {state.connections.map((c) => (
                  <Badge key={c.code} appearance={c.active ? "filled" : "outline"} color={c.active ? "brand" : "subtle"}>
                    {c.code} · {c.name}
                  </Badge>
                ))}
              </div>
            </>
          )}
          {state.paused.length > 0 && (
            <Text>
              {labels.paused}: {state.paused.join(", ")}
            </Text>
          )}
          <Text className={s.muted}>{labels.real}</Text>
        </div>
      </PageContent>
    </>
  );
}
