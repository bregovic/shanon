"use client";

/** Lišta tiskové stránky: šablona, Tisk / PDF (skrytá při tisku). */
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Select } from "@fluentui/react-components";
import { ArrowLeft24Regular, Print24Regular } from "@fluentui/react-icons";

export function PrintToolbar({
  title,
  templates,
  templateId,
  autoPrint,
  labels,
}: {
  title: string;
  templates: { id: string; name: string }[];
  templateId: string | null;
  autoPrint: boolean;
  labels: { print: string; template: string; back: string };
}) {
  const router = useRouter();
  const sp = useSearchParams();
  useEffect(() => {
    if (autoPrint) setTimeout(() => window.print(), 400);
  }, [autoPrint]);
  return (
    <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 16px", background: "#fff", borderBottom: "1px solid #ddd", flexWrap: "wrap" }}>
      <Button appearance="subtle" icon={<ArrowLeft24Regular />} aria-label={labels.back} onClick={() => history.back()} />
      <b style={{ marginRight: "auto" }}>{title}</b>
      {templates.length > 1 && (
        <Select
          aria-label={labels.template}
          value={templateId ?? ""}
          onChange={(_, d) => {
            const q = new URLSearchParams(sp.toString());
            q.set("template", d.value);
            router.replace(`?${q}`);
          }}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      )}
      <Button appearance="primary" icon={<Print24Regular />} onClick={() => window.print()}>
        {labels.print}
      </Button>
    </div>
  );
}
