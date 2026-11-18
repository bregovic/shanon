/**
 * ISDOC: vydaná faktura → ISDOC XML → PDF s vloženým ISDOC → import toho PDF
 * (i .isdoc a .isdocx) jako dokladu ke zpracování bez OCR → zalistování.
 */
import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, inTenant, listRecords, runAction, saveRecord } from "@/server/data";
import { addFile } from "@/server/docuref";
import { provisionTenant } from "@/server/provision";
import { printJob } from "@/server/print";
import { renderPdf } from "@/server/print-pdf";
import { invoiceIsdoc, isdocFromFile, parseIsdoc } from "@/modules/prt/isdoc";

const client = createPrisma();
const run = Date.now().toString(36);

/** Jednosouborový ZIP (ISDOCX) s komprimovaným souborem. */
function zip(name: string, data: Buffer): Buffer {
  const body = deflateRawSync(data);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(8, 8);
  h.writeUInt32LE(body.length, 18);
  h.writeUInt32LE(data.length, 22);
  h.writeUInt16LE(Buffer.byteLength(name), 26);
  return Buffer.concat([h, Buffer.from(name), body]);
}

describe("ISDOC", () => {
  it("export faktury, ISDOC v PDF, import PDF / .isdoc / .isdocx bez OCR", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 })); // registry mimo test
    const T = (await provisionTenant(client, { code: `t-isd-${run}`, name: "ISD", adminEmail: `isd-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "ap", "int", "org"], company: { code: "S", name: "Uzeniny Vzor" } })).ctx;
    const [org] = (await listRecords(T, "org.entity", {}, client)).rows;
    await saveRecord(T, "org.entity", String(org.id), { legalName: "Uzeniny Vzor s.r.o.", regNo: "87654321", vatId: "CZ87654321", street: "Polní", houseNo: "5", city: "Brno", zipCode: "664 00", bankAccount: "123456789/0100" }, undefined, client);
    const subj = await saveRecord(T, "gab.subject", null, { name: "Restaurace U Lípy", regNo: "11223344", vatId: "CZ11223344" }, undefined, client);
    const [grp] = (await listRecords(T, "ar.group", {}, client)).rows;
    const cust = await saveRecord(T, "ar.customer", null, { subjectId: subj.id, groupId: grp.id }, undefined, client);
    const inv = await saveRecord(T, "ar.invoice", null, { customerId: cust.id, invoiceDate: "2026-11-14", dueDate: "2026-11-28" }, undefined, client);
    await saveRecord(T, "ar.invoiceLine", null, { invoiceId: inv.id, description: "Klobása", qty: "2", unitPrice: "100" }, undefined, client);
    await runAction(T, "ar.invoice", String(inv.id), "post", client);

    // export
    const x = await inTenant(T, (s) => invoiceIsdoc(s.sys().api(), T.companyId, String(inv.id)), client);
    expect(x.xml).toContain('<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">');
    const p = parseIsdoc(x.xml);
    expect([p.docNumber, p.issuer.regNo, p.issuer.vatId, p.recipient.regNo, p.amountNet, p.taxAmount, p.amountGross, p.vs, p.issuer.bankAccount, p.dueDate]).toEqual([
      inv.invoiceNum, "87654321", "CZ87654321", "11223344", 200, 42, 242, String(inv.invoiceNum).replace(/\D/g, ""), "123456789/0100", "2026-11-28",
    ]);
    expect(p.lines.map((l) => [l.description, l.qty, l.taxRate, l.amountNet])).toEqual([["Klobása", 2, 21, 200]]);

    // PDF faktury s vloženým ISDOC
    const job = await printJob(T, "ar.invoice", String(inv.id), null, client);
    expect(job.attachments.map((a) => a.name)).toEqual([x.name]);
    const pdf = await renderPdf(job.layout, job.data, { attachments: job.attachments });
    expect(pdf.toString("latin1")).toContain("/EmbeddedFile");
    expect(parseIsdoc(isdocFromFile("faktura.pdf", pdf)!).docNumber).toBe(inv.invoiceNum);

    // druhá strana: odběratel načte naše PDF jako přijatou fakturu — bez napojení OCR
    const B = (await provisionTenant(client, { code: `t-isb-${run}`, name: "ISB", adminEmail: `isb-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap", "int"], company: { code: "R", name: "Restaurace" } })).ctx;
    await saveRecord(B, "sys.company", B.companyId!, { regNo: "11223344" }, undefined, client);
    const vs = await saveRecord(B, "gab.subject", null, { name: "Uzeniny Vzor s.r.o.", regNo: "87654321" }, undefined, client);
    const [vg] = (await listRecords(B, "ap.group", {}, client)).rows;
    await saveRecord(B, "ap.vendor", null, { subjectId: vs.id, groupId: vg.id }, undefined, client);
    const files: [string, Buffer][] = [["faktura.pdf", pdf], ["faktura.isdoc", Buffer.from(x.xml)], ["faktura.isdocx", zip("faktura.isdoc", Buffer.from(x.xml))]];
    // ISDOC = přesná data: první se zalistuje sám (úkol Zkontrolovat), další se stejným číslem jsou duplicita ke kontrole
    for (const [i, [name, data]] of files.entries()) {
      const d = await saveRecord(B, "int.document", null, { fileName: name }, undefined, client);
      await addFile(B, "int.document", String(d.id), { name, type: "application/octet-stream", data }, client);
      await runAction(B, "int.document", String(d.id), "extract", client);
      const got = (await getRecord(B, "int.document", String(d.id), client))!;
      expect([name, got.target, got.status, got.docNumber, got.amountGross, got.regNo]).toEqual([name, "apInvoice", i === 0 ? "listed" : "attention", inv.invoiceNum, "242.00", "87654321"]);
    }
    // první zalistovaný: přijatá faktura se stejnými částkami
    const [first] = (await listRecords(B, "int.document", { filter: { fileName: "faktura.pdf" } }, client)).rows;
    const done = (await getRecord(B, "int.document", String(first.id), client))!;
    const ap = (await getRecord(B, "ap.invoice", String(done.resultId), client))!;
    expect([ap.externalNum, ap.amountNet, ap.taxAmount, ap.amountGross]).toEqual([inv.invoiceNum, "200.00", "42.00", "242.00"]);
    vi.unstubAllGlobals();
  });
});
