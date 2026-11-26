/**
 * Obsluhy zařízení (tisková stanice): osobní instalátor s párovacím kódem, odpojení, zkušební stránka
 * tiskárny a kontrola pravidel Správy tisku. Fronta tisku a rozhraní stanice jsou v src/server/station.ts
 * (mimo moduly — importuje registr).
 */
import { UserError, type ObjectHandlers } from "@/core/module";
import { newPairCode } from "@/server/station-codes";
import { wakeStation } from "@/server/station-wake";

export const deviceHandlers: Record<string, ObjectHandlers> = {
  "int.device": {
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
  "int.devicePrinter": {
    beforeSave(_ctx, d) {
      if (!d.label && d.printerName) d.label = String(d.printerName).slice(0, 120);
      const n = Number(d.copies ?? 1);
      if (!Number.isFinite(n) || n < 1 || n > 20) return { copies: "@INT:CopiesRange" };
    },
    actions: {
      /** zkušební stránka do fronty stanice → otevře úlohu (stav tisku) */
      async test(ctx, pr) {
        const job = await ctx.data.create("int.printJob", { deviceId: pr.deviceId, printerId: pr.id, reference: ctx.t("@INT:StationTestTitle"), copies: 1, status: "queued" });
        wakeStation(String(pr.deviceId), 800);
        return { open: { object: "int.printJob", id: String(job.id) } };
      },
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
