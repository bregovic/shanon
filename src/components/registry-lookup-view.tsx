"use client";

/** Adresář → Založit podle IČO / DIČ (ARES, VIES): náhled a založení subjektu. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Checkbox, Field, Input, makeStyles, MessageBar, MessageBarBody, Text, tokens } from "@fluentui/react-components";
import { Add24Regular, Search24Regular } from "@fluentui/react-icons";
import { gabCreateFromRegistryAction, gabLookupAction } from "@/app/actions";
import type { RegistryHit } from "@/modules/gab/registry-lookup";
import { ActionBar, Crumbs, PageContent } from "./page";

const useStyles = makeStyles({
  card: {
    maxWidth: "720px",
    padding: "20px 24px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  row: { display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" },
  grid: { display: "grid", gridTemplateColumns: "140px 1fr", gap: "4px 12px" },
  muted: { color: tokens.colorNeutralForeground3 },
  name: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold },
});

type Labels = Record<"desc" | "query" | "find" | "create" | "alsoVendor" | "alsoCustomer" | "source" | "exists" | "open" | "notFound" | "regNo" | "vatId" | "address", string>;

export function RegistryLookupView({ crumbs, vendor, customer, labels: L }: { crumbs: { label: string; href?: string }[]; vendor: boolean; customer: boolean; labels: Labels }) {
  const s = useStyles();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hit, setHit] = useState<RegistryHit | null | undefined>(undefined);
  const [err, setErr] = useState<string>();
  const [opts, setOpts] = useState({ vendor: false, customer: false });
  const [busy, start] = useTransition();
  const find = () =>
    start(async () => {
      setErr(undefined);
      const r = await gabLookupAction(q);
      if (r.ok) setHit(r.data);
      else {
        setHit(undefined);
        setErr(r.message);
      }
    });
  const create = () =>
    start(async () => {
      const r = await gabCreateFromRegistryAction(q, opts);
      if (r.ok) router.push(`/gab/subject/${r.data}`);
      else setErr(r.message);
    });
  return (
    <>
      <ActionBar>
        <Crumbs items={crumbs} />
      </ActionBar>
      <PageContent>
        <div className={s.card}>
          <Text className={s.muted}>{L.desc}</Text>
          <div className={s.row}>
            <Field label={L.query}>
              <Input value={q} autoFocus onChange={(_, d) => setQ(d.value)} onKeyDown={(e) => e.key === "Enter" && find()} style={{ width: 240 }} />
            </Field>
            <Button appearance="primary" icon={<Search24Regular />} disabled={busy || !q.trim()} onClick={find}>
              {L.find}
            </Button>
          </div>
          {err && (
            <MessageBar intent="error">
              <MessageBarBody>{err}</MessageBarBody>
            </MessageBar>
          )}
          {hit === null && <Text>{L.notFound}</Text>}
          {hit && (
            <>
              <div className={s.name}>{hit.name}</div>
              <div className={s.grid}>
                <Text className={s.muted}>{L.source}</Text>
                <span>
                  <Badge appearance="tint" color={hit.source === "ares" ? "brand" : "informative"}>
                    {hit.source === "ares" ? "ARES" : "VIES"}
                  </Badge>
                </span>
                {hit.regNo && (
                  <>
                    <Text className={s.muted}>{L.regNo}</Text>
                    <Text>{hit.regNo}</Text>
                  </>
                )}
                {hit.vatId && (
                  <>
                    <Text className={s.muted}>{L.vatId}</Text>
                    <Text>{hit.vatId}</Text>
                  </>
                )}
                {(hit.street || hit.city) && (
                  <>
                    <Text className={s.muted}>{L.address}</Text>
                    <Text>{[hit.street, [hit.zipCode, hit.city].filter(Boolean).join(" "), hit.country].filter(Boolean).join(", ")}</Text>
                  </>
                )}
              </div>
              {hit.existingId ? (
                <MessageBar intent="warning">
                  <MessageBarBody>
                    {L.exists} ·{" "}
                    <Button appearance="transparent" size="small" onClick={() => router.push(`/gab/subject/${hit.existingId}`)}>
                      {L.open}
                    </Button>
                  </MessageBarBody>
                </MessageBar>
              ) : (
                <div className={s.row}>
                  <Button appearance="primary" icon={<Add24Regular />} disabled={busy} onClick={create}>
                    {L.create}
                  </Button>
                  {vendor && <Checkbox label={L.alsoVendor} checked={opts.vendor} onChange={(_, d) => setOpts((o) => ({ ...o, vendor: !!d.checked }))} />}
                  {customer && <Checkbox label={L.alsoCustomer} checked={opts.customer} onChange={(_, d) => setOpts((o) => ({ ...o, customer: !!d.checked }))} />}
                </div>
              )}
            </>
          )}
        </div>
      </PageContent>
    </>
  );
}
