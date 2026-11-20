/** Aplikace Portál organizace: přihlášení (zaměstnanec / dodavatel), jinak agendy vybrané firmy. */
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { PortalApp, PortalLogin } from "@/components/portal-app";
import { portalAgendas } from "@/server/portal-app";
import { portalIdentity, portalTenant } from "@/server/portal-auth";
import { getT } from "@/server/i18n";
import { portalLabels } from "./labels";

export const dynamic = "force-dynamic";

export default async function PortalPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ link?: string }> }) {
  const { tenant } = await params;
  const sp = await searchParams;
  const tn = await portalTenant(tenant);
  if (!tn) notFound();
  const t = await getT("cs", tn.id);
  const L = portalLabels(t);
  const id = await portalIdentity(tenant);
  if (!id) {
    const tab = (await cookies()).get("shanon_portal_tab")?.value === "vendor" ? "vendor" : "employee";
    return <PortalLogin tenant={tn.code} orgName={tn.name} L={L} linkInvalid={sp.link === "invalid"} initialTab={tab} />;
  }
  const companyId = id.companies.some((c) => c.companyId === id.prefs.companyId) ? id.prefs.companyId! : id.companies[0].companyId;
  const first = await portalAgendas(id, companyId);
  return (
    <PortalApp
      tenant={tn.code}
      kind={id.kind}
      name={id.name}
      login={id.login}
      companies={id.companies.map((c) => ({ id: c.companyId, name: c.companyName }))}
      companyId={companyId}
      agendas={first?.agendas ?? []}
      limits={{ maxFileMb: first?.maxFileMb ?? 10, maxFiles: first?.maxFiles ?? 5 }}
      lastAgenda={id.prefs.agenda ?? null}
      L={L}
    />
  );
}
