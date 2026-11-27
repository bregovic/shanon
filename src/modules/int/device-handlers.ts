/**
 * Obsluhy zařízení (tisková stanice): osobní instalátor s párovacím kódem, odpojení, zkušební stránka
 * tiskárny a kontrola pravidel Správy tisku. Fronta tisku a rozhraní stanice jsou v src/server/station.ts
 * (mimo moduly — importuje registr).
 */
import { UserError, type ObjectHandlers, type ValidationErrors } from "@/core/module";
import { newPairCode } from "@/server/station-codes";
import { wakeStation } from "@/server/station-wake";
import { SHARE_PATH } from "./print-rules";

export const deviceHandlers: Record<string, ObjectHandlers> = {
  "int.device": {
    /** smazání zařízení: jeho úlohy a pravidla „z tohoto počítače“ pryč (tiskárny se smažou s ním – viz tiskárna) */
    async beforeDelete(ctx, dev) {
      // běžící stanice (ozvala se před chvílí): smazání by ji odpojilo – nejdřív Odpojit, pak smazat
      const seen = dev.lastSeenAt ? new Date(String(dev.lastSeenAt)).getTime() : 0;
      if (dev.paired && Date.now() - seen < 5 * 60_000) return "@INT:DeviceDeleteOnline";
      for (const j of await ctx.data.find("int.printJob", { deviceId: dev.id }, { take: 5000 })) await ctx.data.remove("int.printJob", String(j.id));
      for (const r of await ctx.data.find("int.printRule", { fromDeviceId: dev.id }, { take: 500 })) await ctx.data.remove("int.printRule", String(r.id));
    },
    actions: {
      /**
       * instalace pro Windows: nový párovací kód (3 dny, jednou; předchozí nespotřebovaný přestane platit) →
       * stáhne se Shanon-instalace.exe z adresy s kódem (instalátor si ho přečte ze záznamu o původu souboru)
       */
      async installer(ctx, dev) {
        if (!dev.active) throw new UserError("@SYS:Locked");
        const { code, hash, expires } = newPairCode(ctx.tenantId);
        await ctx.data.update("int.device", String(dev.id), { pairHash: hash, pairExpires: expires.toISOString() });
        return { href: `/api/station/installer/${code}` };
      },
      /** odpojit: klíč stanice přestane platit (stanice skončí s chybou 401), tiskárny zůstanou */
      async unpair(ctx, dev) {
        await ctx.data.update("int.device", String(dev.id), { tokenHash: null, pairHash: null, pairExpires: null, paired: false });
      },
    },
  },
  "int.printJob": {
    actions: {
      /** Zrušit: úloha čeká nebo je odeslaná stanici (ještě nevytištěná) → stanice ji vynechá / nevezme znovu */
      async cancel(ctx, job) {
        if (job.status !== "queued" && job.status !== "sent") throw new UserError("@INT:PJCancelDone");
        await ctx.data.update("int.printJob", String(job.id), { status: "cancelled", message: ctx.t("@INT:PJCancelledBy", { user: ctx.userName ?? "" }).slice(0, 250) });
      },
    },
  },
  "int.netPrintJob": {
    actions: {
      /** Zrušit: tiskárna si úlohu ještě nevyzvedla → nevytiskne ji */
      async cancel(ctx, job) {
        if (job.status !== "queued") throw new UserError("@INT:PJCancelDone");
        await ctx.data.update("int.netPrintJob", String(job.id), { status: "cancelled", message: ctx.t("@INT:PJCancelledBy", { user: ctx.userName ?? "" }).slice(0, 250) });
      },
    },
  },
  "int.devicePrinter": {
    /** smazání tiskárny (i se zařízením): její úlohy a pravidla pryč, pokladna ji přestane používat */
    async beforeDelete(ctx, pr) {
      for (const j of await ctx.data.find("int.printJob", { printerId: pr.id }, { take: 5000 })) await ctx.data.remove("int.printJob", String(j.id));
      for (const r of await ctx.data.find("int.printRule", { printerId: pr.id }, { take: 500 })) await ctx.data.remove("int.printRule", String(r.id));
      try {
        for (const g of await ctx.data.find("pos.register", { stationPrinterId: pr.id }, { take: 100 })) await ctx.data.update("pos.register", String(g.id), { stationPrinterId: null });
      } catch {
        /* pokladna vypnutá */
      }
    },
    async beforeSave(ctx, d, isNew): Promise<ValidationErrors | void> {
      // ruční přidání: tiskárna jiného počítače (Podle tiskárny) nebo model z katalogu doplní název ve Windows, papír a kopie
      const before = isNew || !d.id ? null : await ctx.data.get("int.devicePrinter", String(d.id));
      const fill = (field: string) => (isNew ? !d.printerName : before?.[field] !== d[field]);
      if (d.copyFromId && fill("copyFromId")) {
        const src = await ctx.data.get("int.devicePrinter", String(d.copyFromId));
        if (src) Object.assign(d, { printerName: src.printerName, paper: src.paper, copies: src.copies ?? 1, modelId: src.modelId ?? d.modelId ?? null, driverName: src.driverName ?? null });
      } else if (d.modelId && fill("modelId")) {
        const m = await ctx.data.get("int.printerModel", String(d.modelId));
        if (m) Object.assign(d, { printerName: d.printerName || m.match, paper: m.paper, copies: m.copies ?? 1, ...(isNew ? { enabled: m.usage !== "none" } : {}) });
      }
      if (!d.printerName) return { printerName: "@SYS:Required" };
      if (!d.label && d.printerName) d.label = String(d.printerName).slice(0, 120);
      const n = Number(d.copies ?? 1);
      if (!Number.isFinite(n) || n < 1 || n > 20) return { copies: "@INT:CopiesRange" };
    },
    actions: {
      /** model tiskárny do katalogu firmy: další počítače s touto tiskárnou převezmou papír, kopie a použití */
      async toCatalog(ctx, pr) {
        // podle názvu tiskárny (ten nese model, „EPSON TM-T20IV Receipt“); ovladač bývá společný pro celou řadu
        const match = String(pr.printerName || pr.driverName || "").replace(/\s*\((kopie|copy) \d+\)$/i, "").slice(0, 120);
        if (!match) throw new UserError("@SYS:InvalidValue");
        const usage = pr.enabled === false ? "none" : pr.paper === "a4" || pr.paper === "a6" ? "documents" : "receipts";
        const [old] = await ctx.data.find("int.printerModel", { match }, { take: 1 });
        const m = old
          ? await ctx.data.update("int.printerModel", String(old.id), { paper: pr.paper, copies: pr.copies ?? 1, usage })
          : await ctx.data.create("int.printerModel", { name: match, match, paper: pr.paper, copies: pr.copies ?? 1, usage });
        await ctx.data.update("int.devicePrinter", String(pr.id), { modelId: m.id });
        return { message: ctx.t("@INT:PrinterInCatalog", { name: String(m.name) }) };
      },
      /** zkušební stránka do fronty stanice → otevře úlohu (stav tisku) */
      async test(ctx, pr) {
        const job = await ctx.data.create("int.printJob", { deviceId: pr.deviceId, printerId: pr.id, reference: ctx.t("@INT:StationTestTitle"), copies: 1, status: "queued" });
        wakeStation(String(pr.deviceId), 800);
        return { open: { object: "int.printJob", id: String(job.id) } };
      },
    },
  },
  // sdílená tiskárna z katalogu jde stanici do příkazu – jen tvar \\server\tiskárna
  "int.printerModel": {
    beforeSave(_ctx, d) {
      if (d.connectPath && !SHARE_PATH.test(String(d.connectPath))) return { connectPath: "@INT:PrinterConnectPathBad" };
    },
  },
  "int.printRule": {
    beforeSave(_ctx, d) {
      // pokladna a tisk hned po zaplacení jen u účtenek
      if (d.docType !== undefined && d.docType !== "pos.receipt") {
        d.registerId = null;
        d.autoPrint = false;
      }
    },
  },
};
