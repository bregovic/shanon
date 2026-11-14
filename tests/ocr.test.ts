/**
 * Vytěžování dokladů: mezitabulka, vytěžení mimo transakci (OpenAI podvržené),
 * kontrola, založení partnera, zalistování do agendy s přílohou, denní limit, dávka.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, listRecords, runAction, saveRecord, type Ctx } from "@/server/data";
import { addFile, listDocuRefs } from "@/server/docuref";
import { provisionTenant } from "@/server/provision";
import { processPendingDocuments } from "@/server/doc-import";

const client = createPrisma();
const run = Date.now().toString(36);

const invoice = (over: Record<string, unknown> = {}) => ({
  docType: "invoice",
  issuer: { name: "Masna Novák s.r.o.", regNo: "12345678", vatId: "CZ12345678", street: null, city: "Brno", zip: null, country: "CZ", bankAccount: "123/0100", iban: null },
  recipient: { name: "Uzeniny Test", regNo: "87654321", vatId: null, street: null, city: null, zip: null, country: "CZ", bankAccount: null, iban: null },
  docNumber: "FA-2026-118",
  orderNumber: null,
  issueDate: "2026-11-10",
  taxDate: "2026-11-10",
  dueDate: "2026-11-24",
  vs: "2026118",
  currency: "CZK",
  amountNet: 1500,
  taxAmount: 315,
  amountGross: 1815,
  lines: [
    { description: "Vepřová plec", qty: 10, unit: "kg", unitPrice: 120, taxRate: 21, amountNet: 1200 },
    { description: "Doprava", qty: 1, unit: null, unitPrice: 300, taxRate: 21, amountNet: 300 },
  ],
  note: null,
  ...over,
});

/** Podvržené OpenAI: vrátí daný doklad, počítá volání. */
function fakeOpenAi(result: () => unknown) {
  const calls: { url: string; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ id: "resp_1", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result()) }] }], usage: { input_tokens: 1000, output_tokens: 200 } }), { status: 200 });
  });
  return calls;
}

async function newDoc(T: Ctx, target = "auto") {
  const d = await saveRecord(T, "int.document", null, { fileName: "faktura.pdf", target }, undefined, client);
  await addFile(T, "int.document", String(d.id), { name: "faktura.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 faktura") }, client);
  return d;
}

describe("vytěžování dokladů", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("nahrát → vytěžit → partner → zkontrolovat → zalistovat jako faktura dodavatele s přílohou", async () => {
    process.env.SHANON_TEST_OCR_KEY = "sk-test";
    const T = (await provisionTenant(client, { code: `t-ocr-${run}`, name: "OCR", adminEmail: `ocr-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap", "int"], company: { code: "U", name: "Uzeniny Test" } })).ctx;
    await saveRecord(T, "sys.company", T.companyId!, { regNo: "87654321" }, undefined, client);

    // bez napojení nic
    const d0 = await newDoc(T);
    await expect(runAction(T, "int.document", String(d0.id), "extract", client)).rejects.toMatchObject({ label: "@INT:OcrNoConnection" });
    await saveRecord(T, "int.connection", null, { code: "TEST-OCR", name: "Test", kind: "ocr", driver: "openaiTest", dailyLimit: 2 }, undefined, client);

    const calls = fakeOpenAi(() => invoice());
    await runAction(T, "int.document", String(d0.id), "extract", client);
    expect(calls[0].url).toBe("https://api.openai.com/v1/responses");
    const content = (calls[0].body!.input as { content: unknown }[])[1].content as { type: string; text?: string; file_data?: string }[];
    expect(content[0].text).toContain("87654321"); // ví, kdo jsme
    expect(content[1].type).toBe("input_file");
    let doc = (await getRecord(T, "int.document", String(d0.id), client))!;
    // nákupní faktura (vystavitel není naše firma), partner zatím v agendě není
    expect([doc.target, doc.status, doc.partnerName, doc.regNo, doc.amountGross]).toEqual(["apInvoice", "attention", "Masna Novák s.r.o.", "12345678", "1815.00"]);
    expect(doc.message).toContain("Masna Novák");
    const lines = (await listRecords(T, "int.documentLine", { filter: { documentId: d0.id } }, client)).rows;
    expect(lines.map((l) => [l.description, l.qty, l.amountNet])).toEqual([["Vepřová plec", "10.0000", "1200.00"], ["Doprava", "1.0000", "300.00"]]);
    const log = (await listRecords(T, "int.log", { filter: { operation: "ocr.extract" } }, client)).rows;
    expect(log.map((l) => l.status)).toEqual(["ok"]);

    // partner bez IČO v registru: subjekt z vytěžených údajů + dodavatel
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
    await runAction(T, "int.document", String(d0.id), "createPartner", client);
    doc = (await getRecord(T, "int.document", String(d0.id), client))!;
    expect([doc.status, doc.message]).toEqual(["ready", null]);
    expect(doc.vendorId).toBeTruthy();

    // zalistovat: koncept přijaté faktury s řádky, DPH a přiloženým souborem
    await runAction(T, "int.document", String(d0.id), "list", client);
    doc = (await getRecord(T, "int.document", String(d0.id), client))!;
    expect([doc.status, doc.resultObject]).toEqual(["listed", "ap.invoice"]);
    const inv = (await getRecord(T, "ap.invoice", String(doc.resultId), client))!;
    expect([inv.externalNum, inv.vendorId, inv.invoiceDate, inv.dueDate, inv.vs, inv.amountNet, inv.taxAmount, inv.amountGross, inv.status]).toEqual(["FA-2026-118", doc.vendorId, "2026-11-10", "2026-11-24", "2026118", "1500.00", "315.00", "1815.00", "draft"]);
    expect((await listDocuRefs(T, "ap.invoice", String(inv.id), client)).map((r) => r.name)).toEqual(["faktura.pdf"]);
    // zalistovaný doklad je zamčený
    await expect(runAction(T, "int.document", String(d0.id), "extract", client)).rejects.toMatchObject({ label: "@SYS:Locked" });

    // stejný doklad podruhé → duplicita; nesedící součty → výhrada
    fakeOpenAi(() => invoice({ amountGross: 1900 }));
    const d1 = await newDoc(T);
    await runAction(T, "int.document", String(d1.id), "extract", client);
    doc = (await getRecord(T, "int.document", String(d1.id), client))!;
    expect(doc.status).toBe("attention");
    expect(doc.message).toContain("FA-2026-118");
    expect(doc.message).toContain("1900.00");

    // denní limit 2 doklady
    const d2 = await newDoc(T);
    await expect(runAction(T, "int.document", String(d2.id), "extract", client)).rejects.toMatchObject({ label: "@INT:OcrDailyLimit" });
  });

  it("dávka: nové doklady vytěží, připravené zalistuje (Zalistovat automaticky); záloha a objednávka", async () => {
    process.env.SHANON_TEST_OCR_KEY = "sk-test";
    const T = (await provisionTenant(client, { code: `t-ocr2-${run}`, name: "OCR2", adminEmail: `ocr2-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap", "ar", "int"], company: { code: "U", name: "Uzeniny Test" } })).ctx;
    await saveRecord(T, "sys.company", T.companyId!, { regNo: "87654321" }, undefined, client);
    await saveRecord(T, "int.connection", null, { code: "OCR", name: "OCR", kind: "ocr", driver: "openaiTest", autoList: true }, undefined, client);
    const subj = await saveRecord(T, "gab.subject", null, { name: "Masna Novák s.r.o.", regNo: "12345678" }, undefined, client);
    const [grp] = (await listRecords(T, "ap.group", {}, client)).rows;
    await saveRecord(T, "ap.vendor", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    const results = [invoice({ docType: "advance", docNumber: "ZF-9", lines: [] }), invoice({ docType: "order", issuer: invoice().recipient, recipient: invoice().issuer, docNumber: "OBJ-5" })];
    let i = 0;
    fakeOpenAi(() => results[i++]);
    const a = await newDoc(T);
    const o = await newDoc(T);
    const msg = await processPendingDocuments(T, client);
    expect(msg).toContain("2");
    const da = (await getRecord(T, "int.document", String(a.id), client))!;
    const dob = (await getRecord(T, "int.document", String(o.id), client))!;
    expect([da.target, da.status, dob.target, dob.status]).toEqual(["apAdvance", "listed", "apOrder", "listed"]);
    const adv = (await getRecord(T, "ap.advance", String(da.resultId), client))!;
    expect([adv.externalNum, adv.amount, adv.status]).toEqual(["ZF-9", "1815.00", "open"]);
    const ord = (await getRecord(T, "ap.order", String(dob.resultId), client))!;
    expect([ord.externalRef, ord.amountNet]).toEqual(["OBJ-5", "1500.00"]);
  });
});
