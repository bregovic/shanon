import { notFound } from "next/navigation";
import { MigrationView } from "@/components/migration-view";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";

export const metadata = { title: "Migrace firmy" };

export default async function MigrationPage() {
  const s = await requireSession();
  if (!s.superUser) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  const keys = ["Migration", "MigDesc", "MigTemplate", "MigExport", "MigFile", "MigImages", "MigImagesCount", "MigCheck", "MigRun", "MigRunConfirm", "MigCreated", "MigUpdated"] as const;
  const labels = Object.fromEntries(keys.map((k) => [k, t(`@ORG:${k}`)])) as Record<(typeof keys)[number], string>;
  return <MigrationView crumbs={[{ label: t("@ORG:Module"), href: "/org" }, { label: labels.Migration }]} labels={labels} cancel={t("@SYS:Cancel")} />;
}
