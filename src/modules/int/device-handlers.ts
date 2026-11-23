/**
 * Obsluhy zařízení (tisková stanice): osobní instalátor s párovacím kódem, odpojení. Fronta tisku
 * a rozhraní stanice jsou v src/server/station.ts (mimo moduly — importuje registr).
 */
import { UserError, type ObjectHandlers } from "@/core/module";
import { newPairCode } from "@/server/station-codes";
import { stationInstaller } from "@/server/station-installer";
import { publicUrl } from "@/server/system-mail";

export const deviceHandlers: Record<string, ObjectHandlers> = {
  "int.device": {
    downloads: {
      /** instalátor pro Windows: nový párovací kód (3 dny, jednou) — předchozí nespotřebovaný přestane platit */
      async installer(ctx, dev) {
        if (!dev.active) throw new UserError("@SYS:Locked");
        const { code, hash, expires } = newPairCode(ctx.tenantId);
        await ctx.data.update("int.device", String(dev.id), { pairHash: hash, pairExpires: expires.toISOString() });
        return {
          name: `Shanon-Pokladna-${String(dev.code).replace(/[^A-Za-z0-9_-]/g, "")}.cmd`,
          mime: "application/octet-stream",
          data: await stationInstaller({ url: publicUrl(), code, deviceName: String(dev.name) }),
        };
      },
    },
    actions: {
      /** odpojit: klíč stanice přestane platit (stanice skončí s chybou 401), tiskárny zůstanou */
      async unpair(ctx, dev) {
        await ctx.data.update("int.device", String(dev.id), { tokenHash: null, pairHash: null, pairExpires: null, paired: false });
      },
    },
  },
};
