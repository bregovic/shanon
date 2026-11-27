/** Prodejní terminál pokladny (šablona „Pult s váhou“). */
import { liveOnTestActive } from "@/modules/int/live-guard";
import type { PrintLayout } from "@/core/print";
import { openBaskets } from "@/modules/pos/basket";
import { accountingCurrencyId, currencyRounding } from "@/modules/gl/posting";
import { notFound } from "next/navigation";
import { PosTerminal } from "@/components/pos-terminal";
import { PosLock } from "@/components/pos-lock";
import { isUnlocked, registerPin } from "@/server/pos-lock";
import { can } from "@/core/security";
import { requireSession } from "@/server/auth";
import { getRecord, inTenant } from "@/server/data";
import { getT } from "@/server/i18n";
import { openShiftOf, topItems } from "@/modules/pos/sale";
import { connectionsFor } from "@/modules/int/drivers";
import { bestDiscount } from "@/modules/inv/handlers";
import { fromCents, toCents } from "@/core/money";
import { addressLine, orgOf } from "@/modules/org";
import { vatPayer } from "@/modules/tax/orders";
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
  // zámek PINem: bez odemčení jen zadání PINu (směna běží dál)
  const raw = await inTenant(s.ctx, (sess) => sess.tx.posRegister.findFirst({ where: { id, tenantId: s.ctx.tenantId }, select: { pin: true } }));
  const regWithPin = { ...reg, pin: raw?.pin ?? null };
  const hasPin = !!registerPin(regWithPin);
  if (!(await isUnlocked(s.user.id, regWithPin))) {
    return (
      <PosLock
        registerId={id}
        registerName={String(reg.name)}
        user={s.user.name}
        backHref="/kasa"
        labels={{ title: t("@POS:Locked"), enter: t("@POS:EnterPin"), wrong: t("@POS:WrongPin"), wait: t("@POS:PinWait"), back: t("@POS:Back") }}
      />
    );
  }
  const data = await inTenant(s.ctx, async (sess) => {
    // nabídka zboží: systémově (stačí právo na pokladnu, ne na Sklad / Položky)
    const cat = sess.sys();
    const items = await cat.find("inv.item", { blocked: false }, 5000, { name: "asc" });
    const groups = await cat.find("inv.itemGroup", {}, 500, { code: "asc" });
    const categories = (await cat.find("inv.category", { blocked: false }, 1000, { sortOrder: "asc" })).map((c) => ({
      id: String(c.id),
      name: String(c.name),
      parentId: (c.parentId as string) ?? null,
    }));
    const units = new Map((await cat.find("inv.unit", {}, 500)).map((u) => [String(u.id), String(u.code)]));
    // sazby DPH položek: účtenka vystavená bez připojení (rozpis DPH)
    const rates = new Map((await cat.find("tax.taxCode", {}, 500).catch(() => [])).map((c) => [String(c.id), String(Number(c.rate ?? 0))]));
    const api = sess.sys().api();
    const shift = await openShiftOf(api, id);
    const conns = s.ctx.modules.has("int") ? await connectionsFor(api, id) : {};
    // Správa tisku: účtenky této pokladny na tiskárnu stanice (konkrétní tiskárnu vybere server při tisku)
    const stationRules = s.ctx.modules.has("int") ? (await api.find("int.printRule", { docType: "pos.receipt", active: true }, { take: 100 }).catch(() => [])).filter((r) => !r.registerId || r.registerId === id) : [];
    // tiskárna počítače vybraná přímo u pokladny = účtenky sem, hned po zaplacení
    if (s.ctx.modules.has("int") && reg.stationPrinterId) stationRules.unshift({ registerId: id, printerId: reg.stationPrinterId, autoPrint: true });
    const stationRule = stationRules.find((r) => r.registerId === id) ?? stationRules[0];
    const stationPrinter = stationRule ? await api.get("int.devicePrinter", String(stationRule.printerId)).catch(() => null) : null;
    const station = stationRule ? { paper: String(stationPrinter?.paper ?? "80"), autoPrint: stationRules.some((r) => r.autoPrint) } : null;
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
    // výběr boxu ze seznamu (volba pokladny): aktivní boxy firmy
    const boxPick = String(reg.boxPick ?? "both");
    const boxes = boxPick === "qr" && reg.template !== "boxes" ? [] : (await api.find("pos.box", { active: true }, { take: 500, orderBy: { code: "asc" } })).map((b) => ({ code: String(b.code), name: b.name ? String(b.name) : "" }));
    // výchozí tisková šablona účtenky (Tiskové sestavy), jinak vestavěná účtenka
    const [rt] = await api.find("prt.template", { docType: "pos.receipt", isDefault: true }, { take: 1 }).catch(() => []);
    let receiptLayout: PrintLayout | null = null;
    try {
      receiptLayout = rt?.layout ? (JSON.parse(String(rt.layout)) as PrintLayout) : null;
    } catch {
      receiptLayout = null;
    }
    // hlavička účtenky pro prodej bez připojení (stejná jako receiptPrint)
    const org = await orgOf(api);
    const [tp] = org ? [] : await api.find("tax.parameters", {}, { take: 1 }).catch(() => []);
    const company = s.ctx.companyId ? await api.get("sys.company", s.ctx.companyId) : null;
    const offline = {
      company: {
        name: String(org?.legalName ?? company?.name ?? ""),
        tradeName: org?.tradeName && org.tradeName !== org.legalName ? String(org.tradeName) : null,
        regNo: ((org?.regNo ?? company?.regNo) as string) ?? null,
        vatId: ((org?.vatId ?? company?.vatId) as string) ?? null,
        address: addressLine(org ?? tp),
        registration: (org?.registration as string) || null,
      },
      vatPayer: await vatPayer(api),
      footer: (reg.receiptFooter as string) ?? null,
      // karta jen na samostatném terminálu (napojený terminál potřebuje připojení)
      card: !conns.payment || conns.payment.driver === "manual",
    };
    // testovací server s ručně povoleným ostrým napojením (EET, platby): kasa to musí hlásit
    const liveOnTest = Object.values(conns).filter((c) => liveOnTestActive(c)).map((c) => String(c!.code));
    return { items, groups, units, rates, offline, shift, conns, station, eetPending, promo, categories, top, rounding, baskets, receiptLayout, boxPick, boxes, liveOnTest };
  });
  const used = new Set(data.items.map((i) => String(i.groupId)));
  // texty terminálu = všechny labely modulu POS
  const labels = Object.fromEntries(Object.keys(pos.labels.cs).map((k) => [k, t(`@POS:${k}`)]));

  return (
    <PosTerminal
      boxPick={data.boxPick as "both" | "qr" | "list"}
      template={(["till", "boxes"].includes(String(reg.template)) ? reg.template : "counter") as "counter"}
      boxes={data.boxes}
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
          rate: data.rates.get(String(i.taxCodeId)) ?? "0",
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
        // tiskárna na sériovém portu / USB tiskne sama; jinak má přednost tisková stanice (Správa tisku)
        data.station && !["escposSerial", "escposUsb", "escposNet", "escposSdp"].includes(String(data.conns.printer?.driver))
          ? { driver: "station", paperWidth: data.station.paper, codePage: "cp852", baudRate: 9600, openDrawer: false, autoPrint: data.station.autoPrint }
          : data.conns.printer
          ? {
              driver: String(data.conns.printer.driver),
              paperWidth: String(data.conns.printer.paperWidth ?? "80"),
              codePage: data.conns.printer.codePage === "ascii" ? "ascii" : "cp852",
              baudRate: Number(data.conns.printer.baudRate ?? 9600),
              openDrawer: !!data.conns.printer.openDrawer,
              autoPrint: !!data.conns.printer.autoPrint,
              host: data.conns.printer.printerHost ? String(data.conns.printer.printerHost).trim().replace(/\.+$/, "") : undefined,
            }
          : null
      }
      payment={data.conns.payment ? { driver: String(data.conns.payment.driver) } : null}
      // ověřená váha (Dialog 06): panel Váha místo dialogu hmotnosti; cenu počítá váha
      verifiedScale={
        reg.template !== "till" && data.conns.scale && data.conns.scale.scaleProtocol === "dialog06"
          ? {
              driver: String(data.conns.scale.driver),
              baudRate: Number(data.conns.scale.baudRate ?? 9600),
              dataBits: Number(data.conns.scale.dataBits) === 7 ? 7 : 8,
              parity: (["even", "odd"].includes(String(data.conns.scale.parity)) ? data.conns.scale.parity : "none") as "none",
              stopBits: Number(data.conns.scale.stopBits) === 2 ? 2 : 1,
              autoAddSec: Math.max(0, Number(data.conns.scale.scaleAutoAddSec ?? 0)),
              beep: data.conns.scale.scaleBeep !== false,
              confirm: data.conns.scale.scaleConfirm === true,
            }
          : null
      }
      scale={
        reg.template !== "till" && data.conns.scale && data.conns.scale.scaleProtocol !== "dialog06"
          ? {
              driver: String(data.conns.scale.driver),
              protocol: (["toledo8217", "casEcr", "continuous"].includes(String(data.conns.scale.scaleProtocol)) ? data.conns.scale.scaleProtocol : "toledo8217") as "toledo8217",
              baudRate: Number(data.conns.scale.baudRate ?? 9600),
              dataBits: Number(data.conns.scale.dataBits) === 7 ? 7 : 8,
              parity: (["even", "odd"].includes(String(data.conns.scale.parity)) ? data.conns.scale.parity : "none") as "none",
              stopBits: Number(data.conns.scale.stopBits) === 2 ? 2 : 1,
            }
          : null
      }
      eet={data.conns.eet ? { pending: data.eetPending } : null}
      liveOnTest={data.liveOnTest}
      offline={data.offline}
      customers={s.ctx.modules.has("ar")}
      mail={s.ctx.modules.has("int")}
      user={s.user.name}
      canLock={hasPin}
      lang={s.lang}
      labels={labels}
    />
  );
}
