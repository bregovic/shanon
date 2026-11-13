/** Výběr pokladny; jediná pokladna se otevře rovnou. */
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth";
import { listRecords } from "@/server/data";
import { getT } from "@/server/i18n";

export const metadata = { title: "Pokladna" };

export default async function KasaPage() {
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  if (!s.ctx.modules.has("pos") || !s.ctx.companyId) return <p style={{ padding: 24 }}>{t("@SYS:NoAccess")}</p>;
  const regs = (await listRecords(s.ctx, "pos.register", { filter: { blocked: false } })).rows;
  if (regs.length === 1) redirect(`/kasa/${regs[0].id}`);
  return (
    <main style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, maxWidth: 480 }}>
      <h1 style={{ fontSize: 24 }}>{t("@POS:ChooseRegister")}</h1>
      {!regs.length && <p>{t("@POS:NoRegister")}</p>}
      {regs.map((r) => (
        <Link key={String(r.id)} href={`/kasa/${r.id}`} style={{ fontSize: 20, padding: "12px 0" }}>
          {String(r.name)} ({String(r.code)})
        </Link>
      ))}
      <Link href="/pos">← {t("@POS:Module")}</Link>
    </main>
  );
}
