import { notFound } from "next/navigation";
import { RegistryLookupView } from "@/components/registry-lookup-view";
import { can } from "@/core/security";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";

export const metadata = { title: "Založit podle IČO / DIČ" };

export default async function LookupPage() {
  const s = await requireSession();
  if (!s.ctx.modules.has("gab") || !can(s.ctx.perms, "gab.subject", "write")) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  const k = (x: string) => t(`@GAB:${x}`);
  return (
    <RegistryLookupView
      crumbs={[{ label: k("Module"), href: "/gab" }, { label: k("Lookup") }]}
      vendor={s.ctx.modules.has("ap") && can(s.ctx.perms, "ap.vendor", "write")}
      customer={s.ctx.modules.has("ar") && can(s.ctx.perms, "ar.customer", "write")}
      labels={{
        desc: k("LookupDesc"),
        query: k("LookupQuery"),
        find: k("LookupFind"),
        create: k("LookupCreate"),
        alsoVendor: k("LookupAlsoVendor"),
        alsoCustomer: k("LookupAlsoCustomer"),
        source: k("LookupSource"),
        exists: k("LookupExists"),
        open: k("LookupOpen"),
        notFound: k("LookupNotFound"),
        regNo: t("@SYS:RegNo"),
        vatId: t("@SYS:VatId"),
        address: k("Address"),
      }}
    />
  );
}
