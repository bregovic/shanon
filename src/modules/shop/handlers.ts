/**
 * Obsluha e-shopu: jeden obchod na firmu a jeho veřejná adresa, kategorie bez cyklu, akce objednávky
 * (Vyřízeno, Zrušit) a uhrazení — spárovaná platba zálohy označí objednávku jako uhrazenou.
 */
import { UserError, type ObjectHandlers, type RecordData, type ValidationErrors } from "@/core/module";
import { notify } from "@/modules/sys/notify";
import { cancelShopOrder } from "./catalog";

export const shopHandlers: Record<string, ObjectHandlers> = {
  "shop.shop": {
    async beforeSave(ctx, d, isNew): Promise<ValidationErrors | void> {
      if (isNew && (await ctx.data.find("shop.shop", {}, { take: 1 })).length) throw new UserError("@SHOP:OneShop");
      // adresa obchodu = zkratka organizace pro veřejné odkazy
      const [org] = await ctx.data.find("org.entity", {}, { take: 1 }).catch(() => [] as RecordData[]);
      d.publicUrl = org?.publicSlug ? `/${org.publicSlug}` : null;
      if (d.active && !d.publicUrl) return { active: "@SHOP:NoSlug" };
    },
  },
  "shop.category": {
    async beforeSave(ctx, d): Promise<ValidationErrors | void> {
      let p = d.parentId ? String(d.parentId) : null;
      for (let i = 0; p && i < 20; i++) {
        if (p === d.id) return { parentId: "@INV:CategoryLoop" };
        p = ((await ctx.data.get("shop.category", p))?.parentId as string) ?? null;
      }
    },
  },
  "shop.order": {
    actions: {
      async ship(ctx, so) {
        if (so.status !== "paid" && so.status !== "ready") throw new UserError("@GL:Locked");
        await ctx.data.update("shop.order", String(so.id), { status: "shipped" });
      },
      async cancel(ctx, so) {
        await cancelShopOrder(ctx.data, so);
      },
    },
  },
  // platba převodem: spárovaná úhrada zálohy → objednávka k vyřízení
  "ar.advance": {
    async afterSave(ctx, a) {
      if (a.status !== "paid" && a.status !== "settled") return;
      if (!ctx.modules?.has("shop")) return;
      for (const so of await ctx.data.find("shop.order", { advanceId: a.id, status: "awaitingPayment" }, { take: 5 })) {
        await ctx.data.update("shop.order", String(so.id), { status: "paid" });
        await notify(ctx.data, { kind: "info", title: "@SHOP:NotifyPaid", params: { num: String(so.orderNum) }, href: `/shop/order?focus=${so.id}`, key: `shop-paid-${so.id}` });
      }
    },
  },
};
