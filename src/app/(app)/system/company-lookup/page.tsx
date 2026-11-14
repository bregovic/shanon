import { notFound } from "next/navigation";
import { RegistryLookupView } from "@/components/registry-lookup-view";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";

export const metadata = { title: "Založit firmu podle IČO / DIČ" };

export default async function CompanyLookupPage() {
  const s = await requireSession();
  if (!s.superUser) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  const k = (x: string) => t(`@GAB:${x}`);
  return (
    <RegistryLookupView
      mode="company"
      crumbs={[{ label: t("@ORG:Module"), href: "/org" }, { label: t("@ORG:CompanyLookup") }]}
      vendor={false}
      customer={false}
      labels={{
        desc: t("@ORG:CompanyLookupDesc"),
        query: k("LookupQuery"),
        find: k("LookupFind"),
        create: t("@ORG:CompanyCreate"),
        alsoVendor: "",
        alsoCustomer: "",
        source: k("LookupSource"),
        exists: t("@ORG:CompanyExists"),
        update: k("LookupUpdate"),
        open: k("LookupOpen"),
        notFound: k("LookupNotFound"),
        regNo: t("@SYS:RegNo"),
        vatId: t("@SYS:VatId"),
        address: k("Address"),
      }}
    />
  );
}
