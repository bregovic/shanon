import { notFound } from "next/navigation";
import { TestEnvView } from "@/components/test-env-view";
import { can } from "@/core/security";
import { testEnvState } from "@/modules/int/test-env";
import { requireSession } from "@/server/auth";
import { inTenant } from "@/server/data";
import { getT } from "@/server/i18n";

export const metadata = { title: "Testovací prostředí" };

export default async function TestEnvPage() {
  const s = await requireSession();
  if (!s.ctx.modules.has("int") || !s.ctx.companyId || !can(s.ctx.perms, "int.connection", "write")) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  const state = await inTenant(s.ctx, (sess) => testEnvState(sess.sys().api()));
  const k = (x: string) => t(`@INT:${x}`);
  return (
    <TestEnvView
      crumbs={[{ label: k("Module"), href: "/int" }, { label: k("TestEnv") }]}
      initial={state}
      items={[k("TestEnvEet"), k("TestEnvPay"), k("TestEnvPrint"), ...(s.ctx.modules.has("pos") ? [k("TestEnvBoxes")] : [])]}
      labels={{
        intro: k("TestEnvIntro"),
        will: k("TestEnvWill"),
        on: k("TestEnvOn"),
        off: k("TestEnvOff"),
        active: k("TestEnvActive"),
        inactive: k("TestEnvInactive"),
        paused: k("TestEnvPaused"),
        real: k("TestEnvReal"),
        connections: t("@INT:Connections"),
      }}
    />
  );
}
