/** Paměť čtení transakce: kopie pro volajícího, zápis objektu ji zahodí, hromadný zápis mimo save přes forgetReads. */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { forgetReads, inTenant, listRecords } from "@/server/data";
import { mergeRecords } from "@/server/merge";
import { provisionTenant } from "@/server/provision";

const client = createPrisma();
const run = Date.now().toString(36);

describe("paměť čtení v transakci", () => {
  it("get / find: kopie, zápis paměť zahodí, nový záznam je ve find, merge a forgetReads", async () => {
    const T = (await provisionTenant(client, { code: `t-rc-${run}`, name: "Rc", adminEmail: `rc-${run}@test.local`, adminPassword: "heslo-12345", modules: ["inv"], company: { code: "C", name: "C" } })).ctx;
    const g = (await listRecords(T, "inv.itemGroup", { pageSize: 1 }, client)).rows[0];
    const ks = (await listRecords(T, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    const base = { groupId: g.id, unitId: ks.id };
    await inTenant(
      T,
      async (s) => {
        const api = s.sys().api();
        const a = await api.create("inv.item", { ...base, itemNum: "A1", name: "Původní", salesPrice: "10" });
        // úprava vrácené kopie se do paměti nepropíše
        const r1 = (await api.get("inv.item", String(a.id)))!;
        r1.name = "Změněno jen v proměnné";
        expect((await api.get("inv.item", String(a.id)))!.name).toBe("Původní");
        // zápis přes datovou službu → další čtení vidí novou hodnotu
        await api.update("inv.item", String(a.id), { name: "Nový název" });
        expect((await api.get("inv.item", String(a.id)))!.name).toBe("Nový název");
        // find v paměti → po založení dalšího záznamu ho najde
        expect((await api.find("inv.item", { groupId: g.id }, { take: 50 })).length).toBe(1);
        const b = await api.create("inv.item", { ...base, itemNum: "A2", name: "Druhý (dodavatel)", salesPrice: "20" });
        expect((await api.find("inv.item", { groupId: g.id }, { take: 50 })).map((x) => x.itemNum).sort()).toEqual(["A1", "A2"]);
        // hromadné přepojení odkazů ve sloučení: kategorie z paměti musí vidět nový stav
        const cat = await api.create("inv.category", { code: "K", name: "K" });
        await api.update("inv.item", String(b.id), { categoryId: cat.id });
        await mergeRecords(s, "inv.item", [String(a.id), String(b.id)]);
        expect(await api.get("inv.item", String(b.id))).toBeNull();
        expect((await api.find("inv.item", { groupId: g.id }, { take: 50 })).map((x) => x.itemNum)).toEqual(["A1"]);
        // zápis mimo save + forgetReads
        await (s.tx as unknown as { invItem: { updateMany(a: unknown): Promise<unknown> } }).invItem.updateMany({ where: { id: String(a.id) }, data: { name: "SQL" } });
        forgetReads(s.tx);
        expect((await api.get("inv.item", String(a.id)))!.name).toBe("SQL");
      },
      client,
    );
  }, 120_000);
});
