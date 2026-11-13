/** Prodejní terminál pokladny (šablona „Pult s váhou“). */
import type { PrintLayout } from "@/core/print";
import { openBaskets } from "@/modules/pos/basket";
import { accountingCurrencyId, currencyRounding } from "@/modules/gl/posting";
import { notFound } from "next/navigation";
import { PosTerminal } from "@/components/pos-terminal";
import { can } from "@/core/security";
import { requireSession } from "@/server/auth";
import { getRecord, inTenant } from "@/server/data";
import { getT } from "@/server/i18n";
import { openShiftOf, topItems } from "@/modules/pos/sale";
import { connectionsFor } from "@/modules/int/drivers";
import { bestDiscount } from "@/modules/inv/handlers";
import { fromCents, toCents } from "@/core/money";
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
    const categories = (await sess.find("inv.category", { blocked: false }, 1000, { sortOrder: "asc" })).map((c) => ({
      id: String(c.id),
      name: String(c.name),
      parentId: (c.parentId as string) ?? null,
    }));
    const units = new Map((await sess.find("inv.unit", {}, 500)).map((u) => [String(u.id), String(u.code)]));
    const api = sess.sys().api();
    const shift = await openShiftOf(api, id);
    const conns = s.ctx.modules.has("int") ? await connectionsFor(api, id) : {};
    const eetPending = conns.eet ? (await api.find("pos.receipt", { registerId: id, eetStatus: "pending" }, { take: 1000 })).length : 0;
    // dnešní akční ceny (stejná pravidla jako při prodeji na serveru)
    const promo = new Map<string, string>();
    const today = new Date().toISOString().slice(0, 10);
    for (const i of items) {
      if (i.priceGross === null) continue;
      const d = await bestDiscount(api, i, toCents(i.priceGross), today);
      if (d) promo.set(String(i.id), fromCents(d.price));
    }
    const top = await topItems(api, id);
    // zaokrouhlení hotovosti podle účetní měny (terminál jen ukazuje, počítá server)
    const rounding = await currencyRounding(api, await accountingCurrencyId(api, s.ctx.companyId));
    const baskets = await openBaskets(api);
    // výchozí tisková šablona účtenky (Tiskové sestavy), jinak vestavěná účtenka
    const [rt] = await api.find("prt.template", { docType: "pos.receipt", isDefault: true }, { take: 1 }).catch(() => []);
    let receiptLayout: PrintLayout | null = null;
    try {
      receiptLayout = rt?.layout ? (JSON.parse(String(rt.layout)) as PrintLayout) : null;
    } catch {
      receiptLayout = null;
    }
    return { items, groups, units, shift, conns, eetPending, promo, categories, top, rounding, baskets, receiptLayout };
  });
  const used = new Set(data.items.map((i) => String(i.groupId)));
  // texty terminálu = všechny labely modulu POS
  const labels = Object.fromEntries(Object.keys(pos.labels.cs).map((k) => [k, t(`@POS:${k}`)]));

  return (
    <PosTerminal
      register={{ id, code: String(reg.code), name: String(reg.name), cashRounding: { unit: Number(data.rounding.cashUnit), method: data.rounding.cashMethod } }}
      shift={data.shift ? { id: String(data.shift.id), num: String(data.shift.shiftNum) } : null}
      items={data.items
        .filter((i) => i.priceGross !== null)
        .map((i) => ({
          id: String(i.id),
          num: String(i.itemNum),
          name: String(i.name),
          groupId: String(i.groupId),
          categoryId: (i.categoryId as string) ?? null,
          unit: data.units.get(String(i.unitId)) ?? "",
          price: data.promo.get(String(i.id)) ?? String(i.priceGross),
          regular: data.promo.has(String(i.id)) ? String(i.priceGross) : null,
          weighed: !!i.weighed,
          ean: (i.ean as string) ?? null,
          image: (i.image as string) ?? null,
        }))}
      groups={data.groups.filter((g) => used.has(String(g.id))).map((g) => ({ id: String(g.id), name: String(g.name) }))}
      categories={data.categories}
      top={data.top}
      baskets={data.baskets}
      receiptLayout={data.receiptLayout}
      printer={
        data.conns.printer
          ? {
              driver: String(data.conns.printer.driver),
              paperWidth: String(data.conns.printer.paperWidth ?? "80"),
              codePage: data.conns.printer.codePage === "ascii" ? "ascii" : "cp852",
              baudRate: Number(data.conns.printer.baudRate ?? 9600),
              openDrawer: !!data.conns.printer.openDrawer,
              autoPrint: !!data.conns.printer.autoPrint,
            }
          : null
      }
      payment={data.conns.payment ? { driver: String(data.conns.payment.driver) } : null}
      eet={data.conns.eet ? { pending: data.eetPending } : null}
      user={s.user.name}
      lang={s.lang}
      labels={labels}
    />
  );
}
