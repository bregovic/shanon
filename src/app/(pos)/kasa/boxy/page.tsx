/** Štítky boxů k tisku: QR s kódem boxu (čtečka v kase otevře nákup boxu). */
import Link from "next/link";
import QRCode from "qrcode";
import { requireSession } from "@/server/auth";
import { listRecords } from "@/server/data";
import { getT } from "@/server/i18n";
import { PrintButton } from "./print-button";

export const metadata = { title: "Štítky boxů" };

export default async function BoxLabelsPage() {
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  if (!s.ctx.modules.has("pos") || !s.ctx.companyId) return <p style={{ padding: 24 }}>{t("@SYS:NoAccess")}</p>;
  const boxes = (await listRecords(s.ctx, "pos.box", { filter: { active: true }, pageSize: 500 })).rows;
  const labels = await Promise.all(
    boxes.map(async (b) => ({ code: String(b.code), name: b.name ? String(b.name) : "", svg: await QRCode.toString(String(b.code), { type: "svg", margin: 1, errorCorrectionLevel: "M" }) })),
  );
  return (
    <main style={{ padding: 24 }}>
      <style>{`
        .box-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(62mm, 1fr)); gap: 6mm; }
        .box-label { border: 1px dashed currentColor; padding: 4mm; display: flex; flex-direction: column; align-items: center; break-inside: avoid; }
        .box-label svg { width: 40mm; height: 40mm; }
        .box-code { font-size: 28pt; font-weight: 700; letter-spacing: 1px; }
        @media print { .no-print { display: none !important; } main { padding: 0 !important; } }
      `}</style>
      <div className="no-print" style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>{t("@POS:BoxLabels")}</h1>
        <PrintButton label={t("@POS:Print")} />
        <Link href="/pos/box">{t("@POS:Boxes")}</Link>
        <p style={{ flexBasis: "100%", margin: 0 }}>{labels.length ? t("@POS:BoxLabelsHint") : t("@POS:NoActiveBoxes")}</p>
      </div>
      <div className="box-grid">
        {labels.map((l) => (
          <div key={l.code} className="box-label">
            <div dangerouslySetInnerHTML={{ __html: l.svg }} />
            <div className="box-code">{l.code}</div>
            {l.name && l.name !== l.code && <div>{l.name}</div>}
          </div>
        ))}
      </div>
    </main>
  );
}
