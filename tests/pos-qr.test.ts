/**
 * QR platba v pokladně: účtenka čeká na platbu (VS z čísla účtenky, QR kód SPAYD na tisku), uzávěrka účtuje
 * na analytiku bankovního účtu pro QR (221), bankovní výpis podle VS a částky spáruje a účtenku označí jako zaplacenou.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, inTenant, listRecords, runAction, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { receiptPrint, sell } from "@/modules/pos/sale";
import { receiptData } from "@/lib/receipt-data";
import { receiptEscPos } from "@/lib/escpos";
import type { DataApi } from "@/core/module";
import { czIban } from "@/core/print";

const client = createPrisma();
const run = Date.now().toString(36);

describe("QR platba v pokladně", () => {
  let P: Ctx;
  let regId: string;
  let item: string;
  const api = <T>(fn: (a: DataApi) => Promise<T>) => inTenant(P, (s) => fn(s.sys().api()), client);
  const acc = async (num: string) => String((await listRecords(P, "gl.account", { filter: { accountNum: num } }, client)).rows[0].id);
  const bal = async (num: string) => (await listRecords(P, "gl.trans", { filter: { accountId: await acc(num) }, totals: true }, client)).totals!.amount;

  beforeAll(async () => {
    P = (await provisionTenant(client, { code: `t-posqr-${run}`, name: "Posqr", adminEmail: `posqr-${run}@test.local`, adminPassword: "heslo-12345", modules: ["pos", "bank"], company: { code: "QR", name: "QR s.r.o.", regNo: "12345678", vatId: "CZ12345678" } })).ctx;
    regId = String((await listRecords(P, "pos.register", {}, client)).rows[0].id);
    const g = (await listRecords(P, "inv.itemGroup", { filter: { code: "ZBOZI" } }, client)).rows[0];
    const ks = (await listRecords(P, "inv.unit", { filter: { code: "KS" } }, client)).rows[0];
    item = String((await saveRecord(P, "inv.item", null, { itemNum: "Q1", name: "Klobása", groupId: g.id, unitId: ks.id, salesPrice: "121", priceInclTax: true }, undefined, client)).id);
    await saveRecord(P, "pos.shift", null, { registerId: regId, openingCash: "0" }, undefined, client);
  }, 120_000);

  it("bez bankovního účtu QR platba nejde", async () => {
    await expect(api((a) => sell(a, { registerId: regId, payment: "qr", lines: [{ itemId: item, qty: "1" }] }))).rejects.toMatchObject({ label: "@POS:QrNoAccount" });
  });

  it("účtenka čeká na platbu, QR na tisku, uzávěrka 261, výpis podle VS spáruje a označí zaplaceno", async () => {
    const bank = await saveRecord(P, "bank.account", null, { code: "KB", name: "Účet", accountNum: "123456789/0100", glAccountId: await acc("221000") }, undefined, client);
    // QR platba se nezaokrouhluje jako hotovost: 2 × 121 = 242
    const r = await api((a) => sell(a, { registerId: regId, payment: "qr", lines: [{ itemId: item, qty: "2" }] }));
    const rec = (await getRecord(P, "pos.receipt", String(r.id), client))!;
    expect([rec.paymentMethod, rec.payStatus, rec.amountPaid, rec.vs]).toEqual(["qr", "awaiting", "242.00", String(rec.receiptNum).replace(/\D/g, "")]);

    const pr = await api((a) => receiptPrint(a, P.companyId, String(r.id)));
    expect(pr.qr).toBe(`SPD*1.0*ACC:${czIban("123456789/0100")}*AM:242.00*CC:CZK*X-VS:${rec.vs}*MSG:Uctenka ${rec.receiptNum}`);
    const d = receiptData(pr, {}, { qr: "QR platba" });
    expect([d.doc.payment, d.doc.vs, d.doc.qrNote]).toEqual(["QR platba", rec.vs, "Čeká na platbu – naskenujte QR kód v bankovní aplikaci."]);
    // termotiskárna: příkaz tisku QR (GS ( k) s daty QR platby
    const bytes = receiptEscPos(pr, new Proxy({} as Record<string, string>, { get: (_, k) => String(k) }), (v) => String(v), { width: 48, codePage: "ascii", drawer: false, locale: "cs-CZ" });
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain(`X-VS:${rec.vs}`);
    expect(text).toContain(`VS ${rec.vs}`);

    // uzávěrka: QR tržba na analytiku bankovního účtu (221), ne do hotovosti ani na 261
    const [shift] = (await listRecords(P, "pos.shift", { filter: { status: "open" } }, client)).rows;
    await runAction(P, "pos.shift", String(shift.id), "close", client);
    const closed = (await getRecord(P, "pos.shift", String(shift.id), client))!;
    expect([closed.qrTotal, closed.cashTotal, closed.cardTotal]).toEqual(["242.00", "0.00", "0.00"]);
    expect(await bal("221000")).toBe("242.00");
    expect(await bal("261000")).toBe("0.00");

    // výpis: jiná částka se nespáruje, přesná částka a VS ano
    const st = await saveRecord(P, "bank.statement", null, { bankAccountId: bank.id, statementNum: "1", date: "2026-11-20", openingBalance: "0" }, undefined, client);
    await saveRecord(P, "bank.statementLine", null, { statementId: st.id, lineNum: 1, date: "2026-11-20", amount: "200", vs: rec.vs }, undefined, client);
    await saveRecord(P, "bank.statementLine", null, { statementId: st.id, lineNum: 2, date: "2026-11-20", amount: "242", vs: rec.vs }, undefined, client);
    await runAction(P, "bank.statement", String(st.id), "match", client);
    const lines = (await listRecords(P, "bank.statementLine", { filter: { statementId: st.id }, sort: "lineNum" }, client)).rows;
    expect(lines.map((l) => [l.lineNum, l.matchKind, l.posReceiptId ?? null])).toEqual([
      [1, "none", null],
      [2, "posReceipt", String(r.id)],
    ]);
    // ručně: částka musí sedět
    await expect(saveRecord(P, "bank.statementLine", String(lines[0].id), { ...lines[0], posReceiptId: r.id }, undefined, client)).rejects.toMatchObject({ label: "@BANK:PosReceiptAmount" });
    await saveRecord(P, "bank.statementLine", String(lines[0].id), { ...lines[0], offsetAccountId: await acc("261000") }, undefined, client);
    await runAction(P, "bank.statement", String(st.id), "post", client);
    const paid = (await getRecord(P, "pos.receipt", String(r.id), client))!;
    expect([paid.payStatus, String(paid.paidDate).slice(0, 10)]).toEqual(["paid", "2026-11-20"]);
    // 221: +242 z uzávěrky, výpis +442 a úhrada účtenky −242; 261 jen ruční řádek −200
    expect(await bal("221000")).toBe("442.00");
    expect(await bal("261000")).toBe("-200.00");
    // zaplacená účtenka už QR netiskne
    expect((await api((a) => receiptPrint(a, P.companyId, String(r.id)))).qr).toBeNull();
    // druhá platba stejné účtenky se nespáruje (už nečeká)
    const st2 = await saveRecord(P, "bank.statement", null, { bankAccountId: bank.id, statementNum: "2", date: "2026-11-21", openingBalance: "-0" }, undefined, client);
    await saveRecord(P, "bank.statementLine", null, { statementId: st2.id, lineNum: 1, date: "2026-11-21", amount: "242", vs: rec.vs }, undefined, client);
    await runAction(P, "bank.statement", String(st2.id), "match", client);
    expect((await listRecords(P, "bank.statementLine", { filter: { statementId: st2.id } }, client)).rows[0].matchKind).toBe("none");
  }, 120_000);
});
