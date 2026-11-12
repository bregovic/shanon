import { notFound } from "next/navigation";
import { SetupView } from "@/components/setup-view";
import { registry } from "@/registry";
import { isAnyAdmin, requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";

export const metadata = { title: "Výchozí nastavení" };

export default async function SetupPage() {
  const s = await requireSession();
  if (!isAnyAdmin(s)) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  const modules = [...registry.modules.values()]
    .filter((m) => s.ctx.modules.has(m.id) && (m.numberSeqs?.length || m.setup))
    .map((m) => ({
      label: t(m.label),
      seqs: (m.numberSeqs ?? []).map((q) => `${q.code} · ${t(q.name)} · ${q.format}`),
    }));
  const company = s.companies.find((c) => c.id === s.ctx.companyId);
  return (
    <SetupView
      crumbs={[{ label: t("@SYS:Module"), href: "/sys" }, { label: t("@SYS:DefaultSetup") }]}
      modules={modules}
      company={company ? `${company.code} · ${company.name}` : ""}
      canAll={s.superUser}
      labels={{
        title: t("@SYS:DefaultSetup"),
        desc: t("@SYS:DefaultSetupDesc"),
        run: t("@SYS:RunSetup"),
        all: t("@SYS:AllCompanies"),
        seqs: t("@SYS:NumberSeqs"),
      }}
    />
  );
}
