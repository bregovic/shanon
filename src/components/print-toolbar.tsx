"use client";

/** Lišta tiskové stránky: šablona, Tisk / PDF (skrytá při tisku). */
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Select } from "@fluentui/react-components";
import { ArrowLeft24Regular, DocumentPdf24Regular, Print24Regular } from "@fluentui/react-icons";

export function PrintToolbar({
  title,
  templates,
  templateId,
  autoPrint,
  labels,
  pdfHref,
  embed,
}: {
  title: string;
  templates: { id: string; name: string }[];
  templateId: string | null;
  autoPrint: boolean;
  labels: { print: string; template: string; back: string; pdf?: string };
  /** odkaz na PDF sestavy (vykreslené na serveru) */
  pdfHref?: string;
  /** náhled v tiskovém dialogu: jen výběr šablony (tisk a PDF mají tlačítka dialogu) */
  embed?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  useEffect(() => {
    if (autoPrint) setTimeout(() => window.print(), 400);
  }, [autoPrint]);
  if (embed && templates.length <= 1) return null;
  if (embed)
    return (
      <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 12px", background: "#fff", borderBottom: "1px solid #ddd" }}>
        <span style={{ fontSize: 13 }}>{labels.template}</span>
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
      </div>
    );
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
      {pdfHref && (
        <Button icon={<DocumentPdf24Regular />} onClick={() => window.open(`${pdfHref}${templateId ? `${pdfHref.includes("?") ? "&" : "?"}template=${templateId}` : ""}`, "_blank")}>
          {labels.pdf}
        </Button>
      )}
      <Button appearance="primary" icon={<Print24Regular />} onClick={() => window.print()}>
        {labels.print}
      </Button>
    </div>
  );
}
