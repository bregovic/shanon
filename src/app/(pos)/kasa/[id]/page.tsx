/** Prodejní terminál pokladny (šablona „Pult s váhou“). */
import { notFound } from "next/navigation";
import { PosTerminal } from "@/components/pos-terminal";
import { can } from "@/core/security";
import { requireSession } from "@/server/auth";
import { getRecord, inTenant } from "@/server/data";
import { getT } from "@/server/i18n";
import { openShiftOf } from "@/modules/pos/sale";
import pos from "@/modules/pos";

export const metadata = { title: "Pokladna" };

export default async function TerminalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  if (!s.ctx.modules.has("pos") || !s.ctx.companyId || !can(s.ctx.perms, "pos.receipt", "write")) {
    return <p style={{ padding: 24 }}>{t("@SYS:NoAccess")}</p>;
  }
  const reg = await getRecord(s.ctx, "pos.register", id).catch(() => null);
  if (!reg) notFound();
  const data = await inTenant(s.ctx, async (sess) => {
    const items = await sess.find("inv.item", { blocked: false }, 5000, { name: "asc" });
    const groups = await sess.find("inv.itemGroup", {}, 500, { code: "asc" });
    const units = new Map((await sess.find("inv.unit", {}, 500)).map((u) => [String(u.id), String(u.code)]));
    const shift = await openShiftOf(sess.sys().api(), id);
    return { items, groups, units, shift };
  });
  const used = new Set(data.items.map((i) => String(i.groupId)));
  // texty terminálu = všechny labely modulu POS
  const labels = Object.fromEntries(Object.keys(pos.labels.cs).map((k) => [k, t(`@POS:${k}`)]));

  return (
    <PosTerminal
      register={{ id, code: String(reg.code), name: String(reg.name), roundCash: !!reg.roundCash }}
      shift={data.shift ? { id: String(data.shift.id), num: String(data.shift.shiftNum) } : null}
      items={data.items
        .filter((i) => i.priceGross !== null)
        .map((i) => ({
          id: String(i.id),
          num: String(i.itemNum),
          name: String(i.name),
          groupId: String(i.groupId),
          unit: data.units.get(String(i.unitId)) ?? "",
          price: String(i.priceGross),
          weighed: !!i.weighed,
          ean: (i.ean as string) ?? null,
        }))}
      groups={data.groups.filter((g) => used.has(String(g.id))).map((g) => ({ id: String(g.id), name: String(g.name) }))}
      user={s.user.name}
      lang={s.lang}
      labels={labels}
    />
  );
}
