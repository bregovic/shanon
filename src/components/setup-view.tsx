"use client";

/** Výchozí nastavení: co moduly do firmy doplní a tlačítko pro spuštění. */
import { useState, useTransition } from "react";
import { Button, makeStyles, MessageBar, MessageBarBody, Text, tokens } from "@fluentui/react-components";
import { ArrowSync24Regular } from "@fluentui/react-icons";
import { runSetupAction } from "@/app/actions";
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
    gap: "16px",
  },
  mod: { borderTop: `1px solid ${tokens.colorNeutralStroke2}`, paddingTop: "12px" },
  seq: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 },
});

export function SetupView({
  crumbs,
  modules,
  company,
  canAll,
  labels,
}: {
  crumbs: { label: string; href?: string }[];
  modules: { label: string; seqs: string[] }[];
  company: string;
  /** superuživatel smí spustit pro všechny firmy */
  canAll: boolean;
  labels: { title: string; desc: string; run: string; all: string; seqs: string };
}) {
  const s = useStyles();
  const [msg, setMsg] = useState<string>();
  const [busy, start] = useTransition();
  const run = (all: boolean) =>
    start(async () => {
      const r = await runSetupAction(all);
      setMsg(r.ok ? r.data : r.message);
    });
  return (
    <>
      <ActionBar>
        <Crumbs items={crumbs} />
        <Spacer />
        <Button appearance="primary" icon={<ArrowSync24Regular />} disabled={busy} onClick={() => run(false)}>
          {labels.run} {company && `(${company})`}
        </Button>
        {canAll && (
          <Button disabled={busy} onClick={() => run(true)}>
            {labels.all}
          </Button>
        )}
      </ActionBar>
      <PageContent>
        {msg && (
          <MessageBar intent="success">
            <MessageBarBody>{msg}</MessageBarBody>
          </MessageBar>
        )}
        <div className={s.card}>
          <Text>{labels.desc}</Text>
          {modules.map((m) => (
            <div key={m.label} className={s.mod}>
              <Text weight="semibold">{m.label}</Text>
              {m.seqs.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <Text size={200}>{labels.seqs}:</Text>
                  {m.seqs.map((q) => (
                    <div key={q} className={s.seq}>
                      {q}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </PageContent>
    </>
  );
}
