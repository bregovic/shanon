/** Doklady ke zpracování: fronta pro „další doklad“ (stav ∈ čekající, mimo aktuální, podle čísla). */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { inTenant, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { registry } from "@/registry";

const client = createPrisma();
const run = Date.now().toString(36);

describe("fronta dokladů ke zpracování", () => {
  it("další čekající doklad podle čísla, hromadné Vytěžit a Zalistovat", async () => {
    const T = (await provisionTenant(client, { code: `t-dq-${run}`, name: "DQ", adminEmail: `dq-${run}@test.local`, adminPassword: "heslo-12345", modules: ["int", "ap"], company: { code: "Q", name: "Q" } })).ctx;
    const a = await saveRecord(T, "int.document", null, { fileName: "a.pdf" }, undefined, client);
    const b = await saveRecord(T, "int.document", null, { fileName: "b.pdf" }, undefined, client);
    const c = await saveRecord(T, "int.document", null, { fileName: "c.pdf" }, undefined, client);
    await inTenant(T, (s) => s.sys().api().update("int.document", String(b.id), { status: "listed" }), client);
    const def = registry.objects.get("int.document")!;
    const list = def.actions!.find((x) => x.id === "list")!;
    expect([list.bulk, def.actions!.find((x) => x.id === "extract")!.bulk]).toEqual([true, true]);
    const next = await inTenant(T, (s) => s.api().find("int.document", { [list.next!.field]: { in: list.next!.in } }, { take: 2, orderBy: { docNum: "asc" } }), client);
    expect(next.find((d) => d.id !== a.id)?.id).toBe(c.id);
  });
});
