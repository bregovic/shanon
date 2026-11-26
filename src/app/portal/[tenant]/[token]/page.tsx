/** Veřejný portál (bez přihlášení): nahrání dokladů dodavateli, nebo uzavření smlouvy (členství). */
import { notFound } from "next/navigation";
import { SupplierPortal } from "@/components/supplier-portal";
import { AgreementPortal } from "@/components/agreement-portal";
import { PortalTheme } from "@/components/portal-theme";
import { portalInfo } from "@/server/supplier-portal";
import { agreementPortalInfo } from "@/server/agreement-portal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portál", robots: { index: false, follow: false } };

export default async function PortalPage({ params }: { params: Promise<{ tenant: string; token: string }> }) {
  const { tenant, token } = await params;
  const agr = await agreementPortalInfo(tenant, token);
  if (agr)
    return (
      <PortalTheme design={agr.design}>
        <AgreementPortal action={`/api/portal/${tenant}/${token}/agreement`} info={agr} />
      </PortalTheme>
    );
  const info = await portalInfo(tenant, token);
  if (!info) notFound();
  return (
    <PortalTheme design={info.design}>
      <SupplierPortal action={`/api/portal/${tenant}/${token}`} info={info} />
    </PortalTheme>
  );
}
