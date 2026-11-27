/** Zákaznická obrazovka: portál s pokladnou, stav nákupu z kasy, dlouhý dotaz obrazovky na změnu. */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, listRecords, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { displayPortalInfo, displayPortalState } from "@/server/display-portal";
import { publishDisplay } from "@/server/pos-display";

const client = createPrisma();
const run = Date.now().toString(36);

describe("zákaznická obrazovka", () => {
  it("portál ukáže úvod, pak nákup pokladny; změnu dostane hned", async () => {
    const P = (await provisionTenant(client, { code: `t-disp-${run}`, name: "Disp", adminEmail: `disp-${run}@test.local`, adminPassword: "heslo-12345", modules: ["pos", "int"], company: { code: "D", name: "Obchod D" } })).ctx;
    const regId = String((await listRecords(P, "pos.register", {}, client)).rows[0].id);
    const pt = await saveRecord(P, "int.portal", null, { name: "Obrazovka", purpose: "display", registerId: regId, slug: "obrazovka", title: "Vítejte", intro: "Dnes čerstvé pečivo" }, undefined, client);
    const portal = (await getRecord(P, "int.portal", String(pt.id), client))!;
    const token = String(portal.token);
    const info = (await displayPortalInfo(P.tenantId, token, client))!;
    expect([info.title, info.intro, info.texts.DisplayTotal]).toEqual(["Vítejte", "Dnes čerstvé pečivo", "Celkem"]);

    // bez nákupu = úvod
    const s0 = (await displayPortalState(P.tenantId, token, -1, client))!;
    expect(s0.state?.phase).toBe("idle");
    // obrazovka čeká na změnu, kasa ji pošle → dotaz se vrátí hned s novým stavem
    const waiting = displayPortalState(P.tenantId, token, s0.version, client);
    publishDisplay(P.tenantId, regId, { phase: "cart", lines: [{ name: "Rohlík", qty: "2 × 4.90", amount: "9.80" }], total: "9.80", customer: "", qr: null, paid: null, change: null });
    const s1 = (await waiting)!;
    expect([s1.state?.phase, s1.state?.lines[0].name, s1.state?.total, s1.version]).toEqual(["cart", "Rohlík", "9.80", s0.version + 1]);

    // portál jiného účelu obrazovkou není
    const docs = await saveRecord(P, "int.portal", null, { name: "Doklady", purpose: "documents", slug: "doklady2" }, undefined, client);
    expect(await displayPortalInfo(P.tenantId, String((await getRecord(P, "int.portal", String(docs.id), client))!.token), client)).toBeNull();
  }, 120_000);
});
