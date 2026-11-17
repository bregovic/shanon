import { notFound } from "next/navigation";
import { PickingBoard } from "@/components/picking-board";
import { connectionsFor } from "@/modules/int/drivers";
import { pickBoard } from "@/modules/shop/picking";
import { can } from "@/core/security";
import { requireSession } from "@/server/auth";
import { inTenant } from "@/server/data";
import { getT } from "@/server/i18n";
import { pickingLabels } from "@/server/ui";

export const metadata = { title: "Vychystávání" };

/** Vychystávání objednávek e-shopu: den vyzvednutí, objednávky / souhrn položek, vážení, dokončení s fakturou. */
export default async function PickingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession();
  if (!s.ctx.modules.has("shop") || !s.ctx.companyId || !can(s.ctx.perms, "shop.order", "read")) notFound();
  const sp = await searchParams;
  const t = await getT(s.lang, s.ctx.tenantId);
  const { board, scale } = await inTenant(s.ctx, async (sess) => {
    const api = sess.sys().api();
    const conns = s.ctx.modules.has("int") ? await connectionsFor(api, "") : {};
    return { board: await pickBoard(api, sp.den ?? null), scale: conns.scale ?? null };
  });
  return (
    <PickingBoard
      crumbs={[{ label: t("@SHOP:Module"), href: "/shop" }, { label: t("@SHOP:Picking") }]}
      initial={board}
      scale={
        scale
          ? {
              driver: String(scale.driver),
              protocol: (["toledo8217", "casEcr", "continuous"].includes(String(scale.scaleProtocol)) ? scale.scaleProtocol : "toledo8217") as "toledo8217",
              baudRate: Number(scale.baudRate ?? 9600),
              dataBits: Number(scale.dataBits) === 7 ? 7 : 8,
              parity: (["even", "odd"].includes(String(scale.parity)) ? scale.parity : "none") as "none",
              stopBits: Number(scale.stopBits) === 2 ? 2 : 1,
            }
          : null
      }
      labels={pickingLabels(t)}
    />
  );
}
