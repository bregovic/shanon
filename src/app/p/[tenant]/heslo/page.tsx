/** Zaměstnanec: nastavení hesla z pozvánky (odkaz 7 dní). */
import { PortalSetPassword } from "@/components/portal-app";
import { employeeByToken, PORTAL_MIN_PASSWORD } from "@/server/portal-auth";
import { getT } from "@/server/i18n";
import { portalLabels } from "../labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nastavení hesla" };

export default async function PortalPassword({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ t?: string }> }) {
  const { tenant } = await params;
  const { t: token = "" } = await searchParams;
  const login = await employeeByToken(tenant, token);
  const t = await getT("cs");
  return <PortalSetPassword tenant={tenant} token={token} login={login} minLength={PORTAL_MIN_PASSWORD} L={portalLabels(t)} />;
}
