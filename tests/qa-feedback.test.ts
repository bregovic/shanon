/**
 * Náměty: zadavatel za jiného uživatele, upozornění správcům na nový námět a zadavateli na odpověď / stav,
 * Vytvořit požadavek.
 */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, runAction, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { listNotices } from "@/server/notices";

const client = createPrisma();
const run = Date.now().toString(36);

describe("náměty", () => {
  it("zadavatel, upozornění, požadavek", async () => {
    const A = (await provisionTenant(client, { code: `t-fb-${run}`, name: "FB", adminEmail: `fb-${run}@test.local`, adminPassword: "heslo-12345", modules: ["qa"], company: { code: "F", name: "Firma F" } })).ctx;
    const u = await client.sysUser.create({ data: { tenantId: A.tenantId, email: `fb2-${run}@test.local`, name: "MUDr. Zkušební", passwordHash: "x", role: "user" } });
    await client.sysUserCompany.create({ data: { tenantId: A.tenantId, userId: u.id, companyId: A.companyId! } });
    const users = [
      { id: A.userId, name: "Správce", role: "admin" },
      { id: u.id, name: "MUDr. Zkušební", role: "user" },
    ];
    const S: Ctx = { ...A, userName: "Správce", users };
    const U: Ctx = { ...A, userId: u.id, userName: "MUDr. Zkušební", users, role: "user" };

    // správce zapíše námět za uživatele: jméno podle vybraného, správce upozornění nedostane (zapsal ho sám)
    const fb = await saveRecord(S, "qa.feedback", null, { kind: "idea", title: "Dodatečná úprava účtenky", authorUserId: u.id }, undefined, client);
    expect([fb.authorUserId, fb.author]).toEqual([u.id, "MUDr. Zkušební"]);
    expect((await listNotices(S, "cs")).unread).toBe(0);

    // námět od uživatele → upozornění správci
    const fb2 = await saveRecord(U, "qa.feedback", null, { kind: "problem", title: "Nejde tisk" }, undefined, client);
    expect([fb2.authorUserId, fb2.author]).toEqual([u.id, "MUDr. Zkušební"]);
    const n = await listNotices(S, "cs");
    expect(n.items.map((x) => [x.text, x.href])).toEqual([[`Nový námět ${fb2.feedbackNum}: Nejde tisk (MUDr. Zkušební)`, `/qa/feedback/${fb2.id}`]]);

    // odpověď správce → upozornění zadavateli
    await saveRecord(S, "qa.feedback", String(fb.id), { reply: "Opravíme v pokladně." }, undefined, client);
    // převod na požadavek: stav Převedeno na požadavek → upozornění se stavem
    const out = await runAction(S, "qa.feedback", String(fb.id), "createIssue", client);
    const iss = (await getRecord(S, "qa.issue", (out as { open: { id: string } }).open.id, client))!;
    expect([iss.title, iss.reportedBy]).toEqual(["Dodatečná úprava účtenky", "MUDr. Zkušební"]);
    const m = await listNotices(U, "cs");
    expect(m.items.map((x) => x.text).sort()).toEqual([`Námět ${fb.feedbackNum} (Dodatečná úprava účtenky): Převedeno na požadavek`, `Odpověď na váš námět ${fb.feedbackNum}: Dodatečná úprava účtenky`].sort());

    // požadavek k vyzkoušení (UAT) → upozornění zadavateli námětu
    await saveRecord(S, "qa.issue", String(iss.id), { status: "uat" }, undefined, client);
    const k = await listNotices(U, "cs");
    expect(k.items[0].text).toBe(`K vyzkoušení: Dodatečná úprava účtenky (požadavek ${iss.issueNum} z vašeho námětu ${fb.feedbackNum})`);
    expect(k.items[0].href).toBe(`/qa/issue/${iss.id}`);
  }, 120_000);
});
