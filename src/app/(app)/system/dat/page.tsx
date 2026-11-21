/** Správa systému → Společná data (DAT): superuživatel se přepne do skryté firmy s výchozí konfigurací pro firmy. */
import { notFound, redirect } from "next/navigation";
import { requireSession, setCompany } from "@/server/auth";
import { ensureDat } from "@/server/dat";

export const dynamic = "force-dynamic";

export default async function DatPage() {
  const s = await requireSession();
  if (!s.superUser) notFound();
  await setCompany(await ensureDat(s.ctx.tenantId));
  redirect("/");
}
