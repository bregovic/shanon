/** Zkouška váhy: sériový port v prohlížeči, dotazy, hledání nastavení, uložení do napojení váhy. */
import { notFound } from "next/navigation";
import { ScaleTester } from "@/components/scale-tester";
import { ActionBar, Crumbs, PageContent } from "@/components/page";
import { can } from "@/core/security";
import { requireSession } from "@/server/auth";
import { inTenant } from "@/server/data";
import { getT } from "@/server/i18n";

export const metadata = { title: "Zkouška váhy" };

const KEYS = [
  "Intro", "Connect", "Reconnect", "Connected", "Baud", "Frame", "Manual", "Listen", "CustomHint", "Send", "Scan", "ScanHint", "ScanDone", "ScanNothing",
  "Settings", "Probe", "Answer", "Weight", "Use", "SaveTo", "NoConnection", "Log", "NoAnswer", "Unsupported", "Saved", "Unstable",
  "P_toledo8217", "P_casEcr", "P_continuous", "P_dialog06", "Dialog06", "Dialog06All", "K_weight", "K_ack", "K_nak", "K_text", "K_noise", "DiagWeight", "DiagLine", "DiagText", "DiagNoise", "DiagSilent", "DiagNext", "DiagSaved", "DiagReacted", "PortBusy", "Service",
];

export default async function ScaleTestPage({ searchParams }: { searchParams: Promise<{ conn?: string }> }) {
  const { conn } = await searchParams;
  const s = await requireSession();
  if (!s.ctx.modules.has("int") || !s.ctx.companyId || !can(s.ctx.perms, "int.connection", "write")) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  const conns = await inTenant(s.ctx, (sess) => sess.sys().api().find("int.connection", { kind: "scale", driver: "scaleSerial" }, { take: 50 }));
  return (
    <>
      <ActionBar>
        <Crumbs items={[{ label: t("@INT:Module"), href: "/int" }, { label: t("@INT:ScaleTest") }]} />
      </ActionBar>
      <PageContent>
        <ScaleTester
          connections={conns
            .map((c) => ({ id: String(c.id), code: String(c.code), name: String(c.name), version: Number(c.version) }))
            // napojení z tlačítka Test na kartě váhy první (předvybrané)
            .sort((a, b) => Number(b.id === conn) - Number(a.id === conn))}
          L={Object.fromEntries(KEYS.map((k) => [k, t(`@INT:ST${k}`)]))}
        />
      </PageContent>
    </>
  );
}
