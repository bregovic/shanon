/**
 * Workflow — pracovní položky (založení bez duplicit, uzavření, Hotovo, upozornění, filtr „me“) a výchozí workflow:
 * doklad z integrace → založit partnera a zalistovat, jinak úkol původci (Hotovo krok zopakuje, ruční zalistování ho dokončí);
 * přijatá faktura → schválení vlastníkem (zamčené Zaúčtovat) → zaúčtování, zamítnutí; chyba vytěžení, odmítnutí, portál.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, inTenant, listRecords, runAction, saveRecord, type Ctx } from "@/server/data";
import { addFile } from "@/server/docuref";
import { provisionTenant } from "@/server/provision";
import { processPendingDocuments } from "@/server/doc-import";
import { listNotices } from "@/server/notices";
import { closeWorkItems, createWorkItem } from "@/modules/wf/work";
import { applyExtraction } from "@/modules/int/documents";
import type { OcrResult } from "@/modules/int/ocr";
import { fireWorkflowEvent } from "@/server/workflow";
import { actOnWorkItem, workflowBar } from "@/server/workflow-bar";

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

  it("výchozí workflow: doklad z integrace → partner + zalistování nebo úkol původci; přijatá faktura → schválení vlastníkem → zaúčtování", async () => {
    process.env.SHANON_TEST_OCR_KEY = "sk-test";
    const T = (await provisionTenant(client, { code: `t-wfo-${run}`, name: "WfO", adminEmail: `wfo-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap", "int"], company: { code: "U", name: "Uzeniny Test" } })).ctx;
    expect(T.modules.has("wf")).toBe(true); // Integrace závisí na Workflow
    // výchozí nastavení: typy účastníků a dvě workflow
    expect((await listRecords(T, "wf.definition", {}, client)).rows.map((d) => d.code)).toEqual(["WF-DOKLADY", "WF-PRIJATE"]);
    const owners = (await listRecords(T, "wf.participantType", {}, client)).rows;
    expect(owners.map((p) => p.code)).toEqual(["ACCOUNTANT", "OWNER"]);
    const ownerUser = await client.sysUser.create({ data: { tenantId: T.tenantId, email: `wfown-${run}@test.local`, name: "Olga Vlastník", passwordHash: "x" } });
    await client.sysUserCompany.create({ data: { tenantId: T.tenantId, userId: ownerUser.id, companyId: T.companyId! } });
    await saveRecord(T, "wf.participantType", String(owners.find((p) => p.code === "OWNER")!.id), { userId: ownerUser.id }, undefined, client);
    const O: Ctx = { ...T, userId: ownerUser.id, userName: "Olga Vlastník" };

    await saveRecord(T, "sys.company", T.companyId!, { regNo: "87654321" }, undefined, client);
    await saveRecord(T, "int.connection", null, { code: "OCR", name: "OCR", kind: "ocr", driver: "openaiTest", dailyLimit: 100 }, undefined, client);
    const subj = await saveRecord(T, "gab.subject", null, { name: "Masna Novák s.r.o.", regNo: "12345678" }, undefined, client);
    const [grp] = (await listRecords(T, "ap.group", {}, client)).rows;
    await saveRecord(T, "ap.vendor", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    const runsOf = async (refId: string) => (await listRecords(T, "wf.instance", { filter: { refId }, pageSize: 10 }, client)).rows;

    // 1) jistý a připravený → zalistováno; faktura čeká na schválení vlastníkem, ručně zaúčtovat nejde
    fakeOpenAi(() => invoice());
    const d1 = await newDoc(T);
    await runAction(T, "int.document", String(d1.id), "extract", client);
    const x1 = (await getRecord(T, "int.document", String(d1.id), client))!;
    expect([x1.status, x1.confidence, x1.resultObject]).toEqual(["listed", "high", "ap.invoice"]);
    expect((await runsOf(String(d1.id))).map((r) => r.status)).toEqual(["completed"]);
    const [run1] = await runsOf(String(x1.resultId));
    expect([run1.status, run1.stepName]).toEqual(["waiting", "Kontrola a schválení"]);
    const [appr] = await tasks(T, { status: "open", kind: "approval" });
    expect([appr.refObject, appr.refId, appr.assignedTo, appr.instanceId]).toEqual(["ap.invoice", x1.resultId, ownerUser.id, run1.id]);
    expect((await listNotices(O, "cs")).items.some((n) => n.href === `/wf/workItem/${appr.id}`)).toBe(true);
    await expect(runAction(T, "ap.invoice", String(x1.resultId), "post", client)).rejects.toMatchObject({ label: "@WF:Locked" });
    // schválit → zaúčtuje se samo
    await runAction(O, "wf.workItem", String(appr.id), "approve", client);
    expect((await getRecord(T, "ap.invoice", String(x1.resultId), client))!.status).toBe("posted");
    expect((await runsOf(String(x1.resultId)))[0].status).toBe("completed");

    // 2) nejistý → ke kontrole + úkol Doplnit údaje původci (kdo nahrál); ruční zalistování krok dokončí;
    //    zamítnutá faktura zůstane v konceptu a jde zaúčtovat ručně
    fakeOpenAi(() => invoice({ confidence: "medium", uncertainFields: ["amountGross", "issueDate"] }));
    const d2 = await newDoc(T);
    await runAction(T, "int.document", String(d2.id), "extract", client);
    const x2 = (await getRecord(T, "int.document", String(d2.id), client))!;
    expect([x2.status, x2.uncertain]).toEqual(["attention", "amountGross, issueDate"]);
    expect(String(x2.message)).toContain("Nejisté údaje: amountGross, issueDate");
    const [fix] = await tasks(T, { status: "open", kind: "fix" });
    expect([fix.refObject, fix.refId, fix.assignedTo]).toEqual(["int.document", String(d2.id), T.userId]);
    expect(String(fix.title)).toContain(`Doplnit údaje: ${x2.docNum}`);
    expect(String(fix.description)).toContain("Nejisté údaje");
    await runAction(T, "int.document", String(d2.id), "list", client);
    expect((await getRecord(T, "wf.workItem", String(fix.id), client))!.status).toBe("done");
    expect((await runsOf(String(d2.id)))[0].status).toBe("completed");
    const inv2 = String((await getRecord(T, "int.document", String(d2.id), client))!.resultId);
    const appr2 = (await tasks(T, { status: "open", kind: "approval" })).find((w) => w.refId === inv2)!;
    await runAction(O, "wf.workItem", String(appr2.id), "reject", client);
    expect((await runsOf(inv2))[0].status).toBe("rejected");
    expect((await getRecord(T, "ap.invoice", inv2, client))!.status).toBe("draft");
    await runAction(T, "ap.invoice", inv2, "post", client);

    // 3) nový dodavatel s IČO → založí se sám; chybí číslo dokladu → úkol, po doplnění Hotovo krok zopakuje
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 })); // registr nedostupný
    const d3 = await newDoc(T);
    await inTenant(T, async (s) => {
      const api = s.sys().api();
      const company = await api.get("sys.company", T.companyId!);
      await applyExtraction(api, (await api.get("int.document", String(d3.id)))!, invoice({ docNumber: null, issuer: { ...invoice().issuer, name: "Pekárna Nová", regNo: "99887766", vatId: null } }) as OcrResult, company, s.sys().eventCtx("int.document").t);
    }, client);
    await inTenant(T, (s) => fireWorkflowEvent(s.sys(), "int.document", String(d3.id), "extracted"), client);
    const fix3 = (await tasks(T, { status: "open", kind: "fix" })).find((w) => w.refId === String(d3.id))!;
    expect(String(fix3.description)).toContain("číslo");
    await saveRecord(T, "int.document", String(d3.id), { docNumber: "PN-77" }, undefined, client);
    await runAction(T, "wf.workItem", String(fix3.id), "done", client);
    const x3 = (await getRecord(T, "int.document", String(d3.id), client))!;
    expect([x3.status, x3.resultObject]).toEqual(["listed", "ap.invoice"]);
    expect((await listRecords(T, "ap.vendor", {}, client)).total).toBe(2);

    // 3b) proužek workflow: doklad čeká na Doplnit údaje → řešitel ho zamítne s komentářem → doklad odmítnut
    fakeOpenAi(() => invoice({ confidence: "low", uncertainFields: ["amountGross"], docNumber: "FA-ZAM" }));
    const d6 = await newDoc(T);
    await runAction(T, "int.document", String(d6.id), "extract", client);
    const bar = (await workflowBar(T, "int.document", String(d6.id), (r) => r))!;
    expect([bar.definition, bar.status, bar.stepName, bar.open.length, bar.open[0].canAct]).toEqual(["Zpracování dokladů z integrace", "waiting", "Založit partnera a zalistovat", 1, true]);
    // jiný uživatel (ne řešitel, bez práv správce) úkol vyřídit nesmí
    await expect(actOnWorkItem({ ...O, perms: { admin: false, levels: {} } }, bar.open[0].id, "reject", null)).rejects.toMatchObject({ label: "@SYS:NoAccess" });
    await actOnWorkItem(T, bar.open[0].id, "reject", "Duplicitní sken");
    expect((await getRecord(T, "int.document", String(d6.id), client))!.status).toBe("rejected");
    const bar2 = (await workflowBar(T, "int.document", String(d6.id), (r) => r))!;
    expect([bar2.status, bar2.open.length, bar2.history[0].status, bar2.history[0].result]).toEqual(["rejected", 0, "rejected", "Duplicitní sken"]);
    // faktura s workflow: proužek ukazuje schválení a jeho historii
    const bar3 = (await workflowBar(T, "ap.invoice", String(x1.resultId), (r) => r))!;
    expect([bar3.status, bar3.history.map((h) => [h.kind, h.status, h.completedBy])]).toEqual(["completed", [["approval", "done", "Olga Vlastník"]]]);

    // 4) chyba vytěžení → úkol „vytěžení selhalo“; odmítnutí dokladu úkol zruší
    fakeOpenAi(() => null, 500);
    const d4 = await newDoc(T);
    await expect(runAction(T, "int.document", String(d4.id), "extract", client)).rejects.toThrow();
    const failed = (await tasks(T, { status: "open", kind: "fix" })).find((w) => w.refId === String(d4.id))!;
    expect(String(failed.title)).toContain("selhalo");
    expect(String(failed.description)).toContain("model overloaded");
    await runAction(T, "int.document", String(d4.id), "reject", client);
    expect((await getRecord(T, "wf.workItem", String(failed.id), client))!.status).toBe("cancelled");

    // 5) portál: připravený doklad se nezalistuje sám, úkol dostane odpovědná osoba portálu (dávka)
    const resp = await client.sysUser.create({ data: { tenantId: T.tenantId, email: `wfo2-${run}@test.local`, name: "Jana Nákup", passwordHash: "x" } });
    const portal = await saveRecord(T, "int.portal", null, { name: "Portál", responsible: resp.id }, undefined, client);
    const d5 = await newDoc(T);
    await client.intDocument.update({ where: { id: String(d5.id) }, data: { source: "portal", portalId: String(portal.id) } });
    fakeOpenAi(() => invoice({ docNumber: "FA-PORTAL" }));
    await processPendingDocuments(T, client);
    const x5 = (await getRecord(T, "int.document", String(d5.id), client))!;
    expect(x5.status).toBe("ready");
    const t5 = (await tasks(T, { status: "open" })).find((w) => w.refId === String(d5.id))!;
    expect([t5.kind, t5.assignedTo]).toEqual(["fix", resp.id]);
    // vlastní zalistování z portálu krok dokončí
    await runAction(T, "int.document", String(d5.id), "list", client);
    expect((await getRecord(T, "wf.workItem", String(t5.id), client))!.status).toBe("done");
  }, 240_000);
});
