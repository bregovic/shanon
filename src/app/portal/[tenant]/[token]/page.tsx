/** Dodavatelský portál — veřejná stránka pro nahrání dokladů (bez přihlášení). */
import { notFound } from "next/navigation";
import { SupplierPortal } from "@/components/supplier-portal";
import { portalInfo } from "@/server/supplier-portal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dodavatelský portál", robots: { index: false, follow: false } };

export default async function PortalPage({ params }: { params: Promise<{ tenant: string; token: string }> }) {
  const { tenant, token } = await params;
  const info = await portalInfo(tenant, token);
  if (!info) notFound();
  return <SupplierPortal action={`/api/portal/${tenant}/${token}`} info={info} />;
}
