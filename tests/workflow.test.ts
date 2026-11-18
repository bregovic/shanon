/**
 * Workflow — pracovní položky: založení bez duplicit, uzavření, akce Hotovo, osobní upozornění, filtr „me“;
 * vytěžování: jistý doklad se zalistuje sám s úkolem Zkontrolovat, nejistý / chybný → úkol Doplnit údaje,
 * zalistování úkoly uzavře, odmítnutí je zruší, portál → úkol odpovědné osobě bez zalistování.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, inTenant, listRecords, runAction, saveRecord, type Ctx } from "@/server/data";
import { addFile } from "@/server/docuref";
import { provisionTenant } from "@/server/provision";
import { processPendingDocuments } from "@/server/doc-import";
import { listNotices } from "@/server/notices";
import { closeWorkItems, createWorkItem } from "@/modules/wf/work";

const client = createPrisma();
const run = Date.now().toString(36);

const invoice = (over: Record<string, unknown> = {}) => ({
  docType: "invoice",
  confidence: "high",
  uncertainFields: [],
  issuer: { name: "Masna Novák s.r.o.", regNo: "12345678", vatId: "CZ12345678", street: null, city: "Brno", zip: null, country: "CZ", bankAccount: "123/0100", iban: null },
  recipient: { name: "Uzeniny Test", regNo: "87654321", vatId: null, street: null, city: null, zip: null, country: "CZ", bankAccount: null, iban: null },
  docNumber: `FA-${Math.random().toString(36).slice(2, 8)}`,
  orderNumber: null,
  issueDate: "2026-11-10",
  taxDate: "2026-11-10",
  dueDate: "2026-11-24",
  vs: "2026118",
  currency: "CZK",
  amountNet: 1500,
  taxAmount: 315,
  amountGross: 1815,
  lines: [{ description: "Vepřová plec", qty: 10, unit: "kg", unitPrice: 150, taxRate: 21, amountNet: 1500 }],
  note: null,
  ...over,
});

function fakeOpenAi(result: () => unknown, status = 200) {
  vi.stubGlobal("fetch", async () =>
    status === 200
      ? new Response(JSON.stringify({ id: "resp_1", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result()) }] }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 })
      : new Response(JSON.stringify({ error: { message: "model overloaded" } }), { status }),
  );
}

async function newDoc(T: Ctx) {
  const d = await saveRecord(T, "int.document", null, { fileName: "faktura.pdf" }, undefined, client);
  await addFile(T, "int.document", String(d.id), { name: "faktura.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 faktura") }, client);
  return d;
}

const tasks = async (T: Ctx, filters: Record<string, string>) => (await listRecords(T, "wf.workItem", { filters, pageSize: 50 }, client)).rows;

describe("workflow — pracovní položky", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("založení bez duplicit, Hotovo, uzavření podle klíče, osobní upozornění a filtr me", async () => {
    const T = (await provisionTenant(client, { code: `t-wf-${run}`, name: "Wf", adminEmail: `wf-${run}@test.local`, adminPassword: "heslo-12345", modules: ["wf"], company: { code: "W", name: "W" } })).ctx;
    const other = await client.sysUser.create({ data: { tenantId: T.tenantId, email: `wf2-${run}@test.local`, name: "Petra Účetní", passwordHash: "x" } });
    await client.sysUserCompany.create({ data: { tenantId: T.tenantId, userId: other.id, companyId: T.companyId! } });
    const P: Ctx = { ...T, userId: other.id, userName: "Petra Účetní" };

    const a = await inTenant(T, (s) => createWorkItem(s.sys().api(), { title: "Doplnit údaje", kind: "fix", assignedTo: other.id, sourceKey: "k1" }), client);
    const again = await inTenant(T, (s) => createWorkItem(s.sys().api(), { title: "Doplnit údaje (znovu)", kind: "fix", assignedTo: other.id, sourceKey: "k1" }), client);
    expect(again!.id).toBe(a!.id);
    expect((await tasks(T, { status: "open" })).length).toBe(1);
    // filtr „me“: řešitel ho vidí, správce (jiný uživatel) ne; podle jména
    expect((await tasks(P, { assignedTo: "me", status: "open" })).map((r) => r.title)).toEqual(["Doplnit údaje (znovu)"]);
    expect((await tasks(T, { assignedTo: "me" })).length).toBe(0);
    expect((await tasks(T, { assignedTo: "petra" })).length).toBe(1);
    // osobní upozornění jen řešiteli
    expect((await listNotices(P, "cs")).items.some((n) => n.text.includes("Doplnit údaje"))).toBe(true);
    expect((await listNotices(T, "cs")).items.some((n) => n.text.includes("Doplnit údaje"))).toBe(false);
    // řešitel musí být uživatel tenanta (vstup od člověka)
    await expect(saveRecord(T, "wf.workItem", null, { title: "X", assignedTo: "00000000-0000-0000-0000-000000000000" }, undefined, client)).rejects.toMatchObject({ label: "@SYS:FixErrors" });
    // Hotovo
    await runAction(P, "wf.workItem", String(a!.id), "done", client);
    const done = (await getRecord(T, "wf.workItem", String(a!.id), client))!;
    expect([done.status, done.completedBy]).toEqual(["done", other.id]);
    // uzavření podle klíče
    await inTenant(T, (s) => createWorkItem(s.sys().api(), { title: "Zkontrolovat", kind: "review", sourceKey: "k2", notify: false }), client);
    expect(await inTenant(T, (s) => closeWorkItems(s.sys().api(), { sourceKey: "k2" }, "cancelled"), client)).toBe(1);
    expect((await tasks(T, { status: "open" })).length).toBe(0);
  }, 120_000);

  it("vytěžování: jistý → zalistovat + Zkontrolovat; nejistý / chyba → Doplnit údaje; zalistování a odmítnutí úkoly uzavřou; portál", async () => {
    process.env.SHANON_TEST_OCR_KEY = "sk-test";
    const T = (await provisionTenant(client, { code: `t-wfo-${run}`, name: "WfO", adminEmail: `wfo-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap", "int"], company: { code: "U", name: "Uzeniny Test" } })).ctx;
    expect(T.modules.has("wf")).toBe(true); // Integrace závisí na Workflow
    await saveRecord(T, "sys.company", T.companyId!, { regNo: "87654321" }, undefined, client);
    await saveRecord(T, "int.connection", null, { code: "OCR", name: "OCR", kind: "ocr", driver: "openaiTest", dailyLimit: 100 }, undefined, client);
    const subj = await saveRecord(T, "gab.subject", null, { name: "Masna Novák s.r.o.", regNo: "12345678" }, undefined, client);
    const [grp] = (await listRecords(T, "ap.group", {}, client)).rows;
    await saveRecord(T, "ap.vendor", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);

    // 1) jistý a připravený → zalistováno + úkol Zkontrolovat (původci = kdo nahrál) s odkazem na fakturu
    fakeOpenAi(() => invoice());
    const d1 = await newDoc(T);
    const r1 = (await runAction(T, "int.document", String(d1.id), "extract", client)) as unknown;
    void r1;
    const x1 = (await getRecord(T, "int.document", String(d1.id), client))!;
    expect([x1.status, x1.confidence, x1.resultObject]).toEqual(["listed", "high", "ap.invoice"]);
    const [rev] = await tasks(T, { status: "open", kind: "review" });
    expect([rev.refObject, rev.refId, rev.assignedTo]).toEqual(["ap.invoice", x1.resultId, T.userId]);
    expect((await listNotices(T, "cs")).items.some((n) => n.href === `/wf/workItem/${rev.id}`)).toBe(true);

    // 2) nejistý → ke kontrole s vyjmenovanými poli + úkol Doplnit údaje; ruční zalistování ho uzavře
    fakeOpenAi(() => invoice({ confidence: "medium", uncertainFields: ["amountGross", "issueDate"] }));
    const d2 = await newDoc(T);
    await runAction(T, "int.document", String(d2.id), "extract", client);
    const x2 = (await getRecord(T, "int.document", String(d2.id), client))!;
    expect([x2.status, x2.uncertain]).toEqual(["attention", "amountGross, issueDate"]);
    expect(String(x2.message)).toContain("Nejisté údaje: amountGross, issueDate");
    const [fix] = await tasks(T, { status: "open", kind: "fix" });
    expect([fix.refObject, fix.refId, String(fix.title)]).toEqual(["int.document", String(d2.id), `Doplnit údaje dokladu ${x2.docNum}`]);
    await runAction(T, "int.document", String(d2.id), "list", client);
    expect((await getRecord(T, "wf.workItem", String(fix.id), client))!.status).toBe("done");

    // 3) chyba vytěžení → úkol „vytěžení selhalo“; odmítnutí dokladu úkol zruší
    fakeOpenAi(() => null, 500);
    const d3 = await newDoc(T);
    await expect(runAction(T, "int.document", String(d3.id), "extract", client)).rejects.toThrow();
    const failed = (await tasks(T, { status: "open", kind: "fix" })).find((w) => w.refId === String(d3.id))!;
    expect(String(failed.title)).toContain("selhalo");
    expect(String(failed.description)).toContain("model overloaded");
    await runAction(T, "int.document", String(d3.id), "reject", client);
    expect((await getRecord(T, "wf.workItem", String(failed.id), client))!.status).toBe("cancelled");

    // 4) portál: připravený doklad se nezalistuje sám, úkol dostane odpovědná osoba portálu (dávka)
    const resp = await client.sysUser.create({ data: { tenantId: T.tenantId, email: `wfo2-${run}@test.local`, name: "Jana Nákup", passwordHash: "x" } });
    const portal = await saveRecord(T, "int.portal", null, { name: "Portál", responsible: resp.id }, undefined, client);
    const d4 = await newDoc(T);
    await client.intDocument.update({ where: { id: String(d4.id) }, data: { source: "portal", portalId: String(portal.id) } });
    fakeOpenAi(() => invoice());
    await processPendingDocuments(T, client);
    const x4 = (await getRecord(T, "int.document", String(d4.id), client))!;
    expect(x4.status).toBe("ready");
    const t4 = (await tasks(T, { status: "open" })).find((w) => w.refId === String(d4.id))!;
    expect([t4.kind, t4.assignedTo]).toEqual(["review", resp.id]);
  }, 180_000);
});
