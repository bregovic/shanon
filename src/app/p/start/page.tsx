/** Start nainstalované aplikace Portál: naposledy použitá organizace, jinak výzva otevřít odkaz z pozvánky. */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PortalNoTenant } from "@/components/portal-app";
import { getT } from "@/server/i18n";

export const dynamic = "force-dynamic";

export default async function PortalStart() {
  const code = (await cookies()).get("shanon_portal_tenant")?.value;
  if (code && /^[a-z0-9][a-z0-9-]{0,39}$/i.test(code)) redirect(`/p/${code}`);
  const t = await getT("cs");
  return <PortalNoTenant title={t("@INT:AppTitle")} text={t("@INT:AppNoTenant")} />;
}
