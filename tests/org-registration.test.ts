/** Spisová značka organizace: rozklad vložené značky, text zápisu na doklady, tisk na účtence. */
import { describe, expect, it } from "vitest";
import { parseFileNumber, registrationText } from "@/modules/org";
import { createPrisma } from "@/server/db";
import { listRecords, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";

const client = createPrisma();
const run = Date.now().toString(36);

describe("spisová značka", () => {
  it("rozklad a text zápisu", () => {
    expect(parseFileNumber("C 327865/MSPH Městský soud v Praze")).toEqual({ fileNumber: "C 327865", court: "MSPH" });
    expect(parseFileNumber("c327865")).toEqual({ fileNumber: "C 327865", court: null });
    expect(parseFileNumber("Dr 1234 vedená u Krajského soudu v Brně")).toEqual({ fileNumber: "Dr 1234", court: "KSBR" });
    expect(parseFileNumber("B 2288/KSOS")).toEqual({ fileNumber: "B 2288", court: "KSOS" });
    expect(parseFileNumber("nic")).toBe(null);
    expect(registrationText("C 327865", "MSPH")).toBe("Zapsáno v obchodním rejstříku vedeném Městským soudem v Praze, oddíl C, vložka 327865");
    expect(registrationText("L 15", "KSHK")).toBe("Zapsáno ve spolkovém rejstříku vedeném Krajským soudem v Hradci Králové, oddíl L, vložka 15");
    expect(registrationText("C 1", null)).toBe(null);
  });

  it("organizace: vložená značka → spisová značka, soud a text; ruční text zůstane", async () => {
    const r = await provisionTenant(client, { code: `t-or-${run}`, name: "Or", adminEmail: `or-${run}@test.local`, adminPassword: "heslo-12345", modules: ["org"], company: { code: "O", name: "Org s.r.o." } });
    const T = r.ctx;
    const [org] = (await listRecords(T, "org.entity", {}, client)).rows;
    const saved = await saveRecord(T, "org.entity", String(org.id), { ...org, fileNumber: "C 327865/MSPH Městský soud v Praze" }, undefined, client);
    expect([saved.fileNumber, saved.registerCourt, saved.registration]).toEqual(["C 327865", "MSPH", "Zapsáno v obchodním rejstříku vedeném Městským soudem v Praze, oddíl C, vložka 327865"]);
    // ručně upravený text se při změně soudu nepřepíše
    const manual = await saveRecord(T, "org.entity", String(org.id), { ...saved, registration: "Zapsaná v OR u MS v Praze, C 327865" }, undefined, client);
    const again = await saveRecord(T, "org.entity", String(org.id), { ...manual, registerCourt: "KSPH" }, undefined, client);
    expect(again.registration).toBe("Zapsaná v OR u MS v Praze, C 327865");
    await expect(saveRecord(T, "org.entity", String(org.id), { ...again, fileNumber: "327865" }, undefined, client)).rejects.toBeTruthy();
  }, 120_000);
});
