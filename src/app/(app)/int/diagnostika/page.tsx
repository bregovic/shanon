/** Integrace → Diagnostika tohoto počítače: tisková stanice a tiskárny počítače, u kterého uživatel sedí. */
import { notFound } from "next/navigation";
import { StationDiag } from "@/components/station-diag";
import { ActionBar, Crumbs, PageContent } from "@/components/page";
import { can } from "@/core/security";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";

export const metadata = { title: "Diagnostika tohoto počítače" };

export default async function StationDiagPage() {
  const s = await requireSession();
  if (!s.ctx.modules.has("int") || !can(s.ctx.perms, "int.device", "read")) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  return (
    <>
      <ActionBar>
        <Crumbs items={[{ label: t("@INT:Module"), href: "/int" }, { label: t("@SYS:StationDiag") }]} />
      </ActionBar>
      <PageContent>
        <div style={{ maxWidth: 760 }}>
          <StationDiag />
        </div>
      </PageContent>
    </>
  );
}
