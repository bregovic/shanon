/**
 * Platební příkazy (návrh úhrad, registr DPH, ABO, SEPA) a hromadný import
 * výpisů (přiřazení firmě, duplicita, návaznost, chybějící výpis) s deníkem HK.
 */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { downloadFile, getRecord, listRecords, runAction, saveRecord, type Ctx } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { gpcHeader, gpcLine } from "@/modules/bank/gpc";
import { importStatementsBulk } from "@/server/bank-import";
import type { AppSession } from "@/server/auth";

const client = createPrisma();
const run = Date.now().toString(36);
const save = (T: Ctx, o: string, d: Record<string, unknown>, id: string | null = null) => saveRecord(T, o, id, d, undefined, client);
const rows = async (T: Ctx, o: string, filter: Record<string, unknown> = {}) => (await listRecords(T, o, { filter, pageSize: 500 }, client)).rows;
const c = (v: string) => BigInt(Math.round(Number(v) * 100));

function gpc(num: string, opening: string, lines: { amount: string; vs: string; msg: string }[], account = "123456789") {
  const cents = lines.map((l) => c(l.amount));
  const credit = cents.filter((x) => x > BigInt(0)).reduce((a, b) => a + b, BigInt(0));
  const debit = -cents.filter((x) => x < BigInt(0)).reduce((a, b) => a + b, BigInt(0));
  const o = c(opening);
  return [
    gpcHeader({ account, name: "Firma", num, date: "2026-11-14", opening: o, closing: o + credit - debit, debit, credit }),
    ...lines.map((l, i) => gpcLine({ counter: "998877" + i, cents: cents[i], vs: l.vs, date: "2026-11-14", message: l.msg })),
  ].join("\r\n");
}

async function setup(code: string) {
  const T = (await provisionTenant(client, { code: `t-${code}-${run}`, name: code, adminEmail: `${code}-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap", "ar", "bank", "org"], company: { code: "B", name: "Banka" } })).ctx;
  const [gl] = await rows(T, "gl.account", { accountNum: "221000" });
  const bank = await save(T, "bank.account", { code: "KB", name: "Běžný", accountNum: "123456789/0100", iban: "CZ6501000000000123456789", glAccountId: gl.id });
  return { T, bank };
}

describe("platební příkazy", () => {
  it("návrh úhrad, výhrady z registru DPH, ABO a SEPA soubor", async () => {
    const { T, bank } = await setup("pay");
    // transformace a platební metody z výchozího nastavení
    expect((await rows(T, "sys.transformation")).map((t) => t.code).sort()).toEqual(["ABO", "EAN13", "GPC", "SEPA", "SPAYD"]);
    const methods = await rows(T, "bank.paymentMethod");
    const abo = methods.find((m) => m.code === "PREVOD")!;
    const sepa = methods.find((m) => m.code === "SEPA")!;
    await save(T, "bank.paymentMethod", { bankAccountId: bank.id }, String(abo.id));
    await save(T, "bank.paymentMethod", { bankAccountId: bank.id }, String(sepa.id));

    // dodavatelé: spolehlivý se zveřejněným účtem, nespolehlivý
    const [vg] = await rows(T, "ap.group");
    const mk = async (name: string, rel: string, acc: string, published: boolean) => {
      const s = await save(T, "gab.subject", { name, vatId: "CZ12345678" });
      await client.gabSubject.update({ where: { id: String(s.id) }, data: { vatReliability: rel } });
      await save(T, "gab.bankAccount", { subjectId: s.id, accountNum: acc });
      if (published) await client.gabBankAccount.updateMany({ where: { subjectId: String(s.id) }, data: { published: true } });
      return save(T, "ap.vendor", { subjectId: s.id, groupId: vg.id });
    };
    const good = await mk("Masna", "reliable", "19-2000145399/0800", true);
    const bad = await mk("Šmelina", "unreliable", "111222333/0300", false);
    const inv = async (v: Record<string, unknown>, num: string, price: string) => {
      const i = await save(T, "ap.invoice", { vendorId: v.id, externalNum: num, invoiceDate: "2026-11-01" });
      await save(T, "ap.invoiceLine", { invoiceId: i.id, description: "Maso", qty: "1", unitPrice: price });
      await runAction(T, "ap.invoice", String(i.id), "post", client);
    };
    await inv(good, "FA-100", "1000");
    await inv(bad, "FA-200", "500");

    const po = await save(T, "bank.paymentOrder", { paymentMethodId: abo.id, paymentDate: "2026-11-20", dueTo: "2026-12-31" });
    expect(po.bankAccountId).toBe(bank.id);
    await runAction(T, "bank.paymentOrder", String(po.id), "suggest", client);
    let lines = await rows(T, "bank.paymentOrderLine", { paymentOrderId: po.id });
    expect(lines.map((l) => [l.documentNum, l.amount, l.accountNum, l.warning]).sort()).toEqual([
      ["FA-100", "1210.00", "19-2000145399/0800", null],
      ["FA-200", "605.00", "111222333/0300", "Nespolehlivý plátce DPH"],
    ]);
    expect((await getRecord(T, "bank.paymentOrder", String(po.id), client))!.total).toBe("1815.00");
    // druhý návrh nic nepřidá (faktury už v příkazu jsou)
    await runAction(T, "bank.paymentOrder", String(po.id), "suggest", client);
    expect((await rows(T, "bank.paymentOrderLine", { paymentOrderId: po.id })).length).toBe(2);

    // nespolehlivý plátce bez odsouhlasení zastaví export
    await expect(downloadFile(T, "bank.paymentOrder", String(po.id), "export", client)).rejects.toMatchObject({ label: "@BANK:Blocked" });
    const badLine = lines.find((l) => l.documentNum === "FA-200")!;
    await save(T, "bank.paymentOrderLine", { approved: true }, String(badLine.id));
    const f = await downloadFile(T, "bank.paymentOrder", String(po.id), "export", client);
    const text = String(f.data);
    expect(f.name).toMatch(/^PP26\d{5}\.kpc$/);
    expect(text.split("\r\n").slice(0, 3)).toEqual([expect.stringMatching(/^UHL1201126/), expect.stringMatching(/^1 1501 \d{3}000 0100$/), "2 123456789 181500 201126"]);
    expect(text).toContain("19-2000145399 121000 100 08000000 0 AV:FA-100");
    expect(text.trimEnd().endsWith("3 +\r\n5 +")).toBe(true);
    expect((await getRecord(T, "bank.paymentOrder", String(po.id), client))!.status).toBe("exported");

    // SEPA
    const po2 = await save(T, "bank.paymentOrder", { paymentMethodId: sepa.id });
    await save(T, "bank.paymentOrderLine", { paymentOrderId: po2.id, vendorId: good.id, amount: "99.50", vs: "77", message: "Záloha" });
    lines = await rows(T, "bank.paymentOrderLine", { paymentOrderId: po2.id });
    expect(lines[0].accountNum).toBe("19-2000145399/0800");
    const x = String((await downloadFile(T, "bank.paymentOrder", String(po2.id), "export", client)).data);
    expect(x).toContain("<IBAN>CZ6501000000000123456789</IBAN>");
    expect(x).toContain('<InstdAmt Ccy="CZK">99.50</InstdAmt>');
    expect(x).toContain("<Ustrd>/VS/77 Zaloha</Ustrd>");
  });
});

describe("hromadný import výpisů", () => {
  it("přiřazení účtu, duplicita, nenavazující zůstatek, chybějící výpis, deník HK hromadně", async () => {
    const { T, bank } = await setup("imp");
    const session = { ctx: T, lang: "cs", companies: [{ id: T.companyId!, code: "B", name: "Banka" }], superUser: true, adminCompanyIds: [T.companyId!] } as unknown as AppSession;
    const file = (body: string) => ({ name: "vypisy.gpc", data: Buffer.from(body) });
    // výpis 1 (0 → 1000), výpis 3 (začíná 900 → nenavazuje a chybí 2), cizí účet
    const r = await importStatementsBulk(session, file([gpc("1", "0", [{ amount: "1000", vs: "1", msg: "Vklad" }]), gpc("3", "900", [{ amount: "-50", vs: "", msg: "Poplatek" }]), gpc("1", "0", [{ amount: "1", vs: "", msg: "x" }], "999999")].join("\r\n")));
    expect(r.map((x) => [x.statementNum, x.status])).toEqual([["001", "imported"], ["003", "warning"], ["001", "error"]]);
    expect(r[1].message).toContain("Nenavazuje zůstatek");
    expect(r[1].message).toContain("Chybí výpis č. 2");
    // duplicita
    const d = await importStatementsBulk(session, file(gpc("1", "0", [{ amount: "1000", vs: "1", msg: "Vklad" }])));
    expect(d[0].status).toBe("duplicate");
    expect((await rows(T, "bank.importLog")).map((l) => l.status).sort()).toEqual(["duplicate", "error", "imported", "warning"]);

    // deník HK z obou výpisů najednou (hromadná akce = akce po záznamech)
    const sts = await rows(T, "bank.statement", { bankAccountId: bank.id });
    for (const st of sts) await runAction(T, "bank.statement", String(st.id), "createJournal", client);
    const st1 = sts.find((s) => s.statementNum === "001")!;
    const j = (await getRecord(T, "bank.statement", String(st1.id), client))!.journalId;
    const jl = await rows(T, "gl.journalLine", { journalId: j });
    expect(jl.map((l) => [l.accountType, l.bankAccountId, l.debit, l.offsetType])).toEqual([["bank", bank.id, "1000.00", "ledger"]]);
    await expect(runAction(T, "bank.statement", String(st1.id), "createJournal", client)).rejects.toMatchObject({ label: "@BANK:JournalExists" });
  });
});
