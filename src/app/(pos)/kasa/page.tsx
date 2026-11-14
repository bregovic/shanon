/** Výběr pokladny: dlaždice se stavem směny; jediná pokladna se otevře rovnou. */
import { redirect } from "next/navigation";
import { PosRegisterPicker, type RegisterTile } from "@/components/pos-register-picker";
import { requireSession } from "@/server/auth";
import { inTenant, listRecords } from "@/server/data";
import { getT } from "@/server/i18n";
import { openShiftOf } from "@/modules/pos/sale";

export const metadata = { title: "Pokladna" };

export default async function KasaPage() {
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  if (!s.ctx.modules.has("pos") || !s.ctx.companyId) return <p style={{ padding: 24 }}>{t("@SYS:NoAccess")}</p>;
  const regs = (await listRecords(s.ctx, "pos.register", { filter: { blocked: false } })).rows;
  if (regs.length === 1) redirect(`/kasa/${regs[0].id}`);
  const tiles: RegisterTile[] = await inTenant(s.ctx, async (sess) => {
    const api = sess.sys().api();
    const out: RegisterTile[] = [];
    for (const r of regs) {
      const sh = await openShiftOf(api, String(r.id));
      const raw = await sess.tx.posRegister.findFirst({ where: { id: String(r.id), tenantId: s.ctx.tenantId }, select: { pin: true } });
      out.push({
        id: String(r.id),
        code: String(r.code),
        name: String(r.name),
        locked: !!raw?.pin,
        shift: sh ? { num: String(sh.shiftNum), since: String(sh.openDate ?? "").split("-").reverse().join(". "), receipts: Number(sh.receiptCount ?? 0) } : null,
      });
    }
    return out;
  });
  const k = (x: string) => t(`@POS:${x}`);
  return (
    <PosRegisterPicker
      registers={tiles}
      labels={{ title: k("ChooseRegister"), none: k("NoRegister"), back: k("Module"), open: k("ShiftOpen"), closed: k("Closed"), receipts: k("ReceiptsN"), pin: k("Pin") }}
    />
  );
}
