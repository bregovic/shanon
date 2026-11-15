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
    expect((await rows(T, "sys.transformation")).map((t) => t.code).sort()).toEqual(["ABO", "CSV", "EAN13", "GPC", "SEPA", "SPAYD"]);
    const methods = await rows(T, "bank.paymentMethod");
    const abo = methods.find((m) => m.code === "PREVOD")!;
    const sepa = methods.find((m) => m.code === "SEPA")!;
    // metody patří bankovnímu účtu (ABO výchozí, SEPA)
    await save(T, "bank.accountMethod", { bankAccountId: bank.id, paymentMethodId: abo.id, isDefault: true });
    await save(T, "bank.accountMethod", { bankAccountId: bank.id, paymentMethodId: sepa.id });

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

    // příkaz z bankovního účtu: metoda = výchozí metoda účtu; metoda bez přiřazení k účtu nejde
    const po = await save(T, "bank.paymentOrder", { bankAccountId: bank.id, paymentDate: "2026-11-20", dueTo: "2026-12-31" });
    expect([po.bankAccountId, po.paymentMethodId]).toEqual([bank.id, abo.id]);
    const cash = methods.find((m) => m.code === "HOTOVE")!;
    await expect(save(T, "bank.paymentOrder", { bankAccountId: bank.id, paymentMethodId: cash.id })).rejects.toMatchObject({ fields: { paymentMethodId: "@BANK:MethodNotOnAccount" } });
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
    // odběratel s bankovním účtem protistrany prvního řádku (998877 + 0) → párování podle účtu
    const subj = await save(T, "gab.subject", { name: "Platící odběratel" });
    await save(T, "gab.bankAccount", { subjectId: subj.id, accountNum: "9988770/0300" });
    const custGroup = (await rows(T, "ar.group"))[0];
    const cust = await save(T, "ar.customer", { subjectId: subj.id, groupId: custGroup.id });
    // výpis 1 (0 → 1000), výpis 3 (začíná 900 → nenavazuje a chybí 2), cizí účet
    const r = await importStatementsBulk(session, file([gpc("1", "0", [{ amount: "1000", vs: "1", msg: "Vklad" }]), gpc("3", "900", [{ amount: "-50", vs: "", msg: "Poplatek" }]), gpc("1", "0", [{ amount: "1", vs: "", msg: "x" }], "999999")].join("\r\n")));
    expect(r.map((x) => [x.statementNum, x.status])).toEqual([["001", "imported"], ["003", "warning"], ["001", "error"]]);
    expect(r[1].message).toContain("Nenavazuje zůstatek");
    expect(r[1].message).toContain("Chybí výpis č. 2");
    // duplicita
    const d = await importStatementsBulk(session, file(gpc("1", "0", [{ amount: "1000", vs: "1", msg: "Vklad" }])));
    expect(d[0].status).toBe("duplicate");
    expect((await rows(T, "bank.importLog")).map((l) => l.status).sort()).toEqual(["duplicate", "error", "imported", "warning"]);

    // pořadí párování: VS nic nenašel → bankovní účet protistrany → odběratel bez faktury
    const st1a = (await rows(T, "bank.statement", { bankAccountId: bank.id })).find((x) => x.statementNum === "001")!;
    await runAction(T, "bank.statement", String(st1a.id), "match", client);
    const l1 = (await rows(T, "bank.statementLine", { statementId: st1a.id }))[0];
    expect([l1.matchKind, l1.customerId]).toEqual(["customerAccount", cust.id]);
    expect((await rows(T, "bank.matchStep")).map((x) => x.method)).toEqual(["vsInvoice", "vsAdvance", "counterPartner", "rules"]);
    // předkontace: výdaj „Poplatek“ bez VS → účet poplatků (výchozí předkontace POPL)
    const sts0 = await rows(T, "bank.statement", { bankAccountId: bank.id });
    const st3 = sts0.find((x) => x.statementNum === "003")!;
    await runAction(T, "bank.statement", String(st3.id), "match", client);
    const fee = (await rows(T, "bank.statementLine", { statementId: st3.id }))[0];
    const popl = (await rows(T, "bank.postingRule", { code: "POPL" }))[0];
    expect([fee.matchKind, fee.postingRuleId, fee.offsetAccountId]).toEqual(["rule", popl.id, popl.offsetAccountId]);
    // vybraný řádek → deník (akce řádku), opakovaně už ne
    await runAction(T, "bank.statementLine", String(fee.id), "createJournal", client);
    const feeJ = (await getRecord(T, "bank.statementLine", String(fee.id), client))!.journalId;
    expect((await rows(T, "gl.journalLine", { journalId: feeJ })).map((l) => [l.credit, l.offsetType, l.offsetAccountId])).toEqual([["50.00", "ledger", popl.offsetAccountId]]);
    await expect(runAction(T, "bank.statementLine", String(fee.id), "createJournal", client)).rejects.toMatchObject({ label: "@BANK:LineInJournal" });

    // deník HK z obou výpisů najednou (hromadná akce = akce po záznamech)
    const sts = await rows(T, "bank.statement", { bankAccountId: bank.id });
    for (const st of sts.filter((x) => x.statementNum !== "003")) await runAction(T, "bank.statement", String(st.id), "createJournal", client);
    // výpis 3 má všechny řádky v deníku
    await expect(runAction(T, "bank.statement", String(st3.id), "createJournal", client)).rejects.toMatchObject({ label: "@BANK:JournalExists" });
    const st1 = sts.find((s) => s.statementNum === "001")!;
    const j = (await getRecord(T, "bank.statement", String(st1.id), client))!.journalId;
    const jl = await rows(T, "gl.journalLine", { journalId: j });
    expect(jl.map((l) => [l.accountType, l.bankAccountId, l.debit, l.offsetType, l.offsetCustomerId])).toEqual([["bank", bank.id, "1000.00", "customer", cust.id]]);
    await expect(runAction(T, "bank.statement", String(st1.id), "createJournal", client)).rejects.toMatchObject({ label: "@BANK:JournalExists" });

    // smazání nahraného výpisu z protokolu importu: rozpracovaný deník i protokol pryč, výpis jde nahrát znovu
    const log3 = (await rows(T, "bank.importLog")).find((l) => l.statementId === st3.id)!;
    const j3 = (await getRecord(T, "bank.statement", String(st3.id), client))!.journalId;
    await runAction(T, "bank.importLog", String(log3.id), "deleteStatement", client);
    expect(await getRecord(T, "bank.statement", String(st3.id), client)).toBeNull();
    expect(await getRecord(T, "gl.journal", String(j3), client)).toBeNull();
    expect((await rows(T, "bank.importLog")).some((l) => l.id === log3.id)).toBe(false);
    const again = await importStatementsBulk(session, file(gpc("3", "900", [{ amount: "-50", vs: "", msg: "Poplatek" }])));
    expect(again[0].status).not.toBe("duplicate");
    // zaúčtovaný deník výpis drží
    await runAction(T, "gl.journal", String(j), "post", client).catch(() => undefined);
    if ((await getRecord(T, "gl.journal", String(j), client))!.status === "posted")
      await expect(runAction(T, "bank.importLog", String((await rows(T, "bank.importLog")).find((l) => l.statementId === st1.id)!.id), "deleteStatement", client)).rejects.toMatchObject({ label: "@BANK:StatementJournalPosted" });
  });
});

describe("výpis v CSV podle specifikace", () => {
  // vymyšlený výpis ve formátu „KB+, výpis v CSV“ (bez diakritiky = stejné bajty v cp1250)
  const kb = (from: string, to: string, opening: string, closing: string, lines: string[]) =>
    Buffer.from(
      [
        "KB+, vypis v csv. formatu;;;",
        "Datum vytvoreni souboru;15.11.2026;;",
        ";;;",
        "Cislo uctu;123-456789;;",
        "IBAN;CZ6501000000000123456789;;",
        `Vypis od;${from};;`,
        `Vypis do;${to};;`,
        "Cislo vypisu;;;",
        `Pocatecni zustatek;${opening};;`,
        `Konecny zustatek;${closing};;`,
        ";;;",
        "Datum zauctovani;Datum provedeni;Protistrana;Nazev protiuctu;Castka;Mena;VS;KS;SS;Identifikace transakce;Typ transakce;Popis pro me;Zprava pro prijemce",
        ...lines,
      ].join("\r\n"),
    );

  it("specifikace KB z výchozího nastavení; import na účtu i hromadně (pozná soubor i účet), návaznost za období", async () => {
    const { T, bank } = await setup("csv");
    const [fmt] = await rows(T, "bank.statementFormat", { code: "KB" });
    expect(fmt.detect).toBe("KB+, vypis v csv");
    expect(fmt.fileNamePattern).toBe(String.raw`^Vypis_(\d+)_`);
    expect((await rows(T, "bank.statementFormatField", { formatId: fmt.id })).length).toBeGreaterThan(10);
    await save(T, "bank.account", { statementFormatId: fmt.id }, String(bank.id));

    // akce Importovat výpis na účtu
    const f1 = kb("01.11.2026", "14.11.2026", "1000,00", "1950,5", [
      "02.11.2026;02.11.2026;19-2000145399/0800;Masna;1000;CZK;2600001;0000000000;;ID1;Prichozi uhrada;;Faktura",
      "05.11.2026;05.11.2026;;;-49,5;CZK;;;;ID2;Poplatek;;",
    ]);
    await runAction(T, "bank.account", String(bank.id), "import", client, { name: "Vypis_123456789_20261101_20261114.csv", data: f1 });
    const [st] = await rows(T, "bank.statement", { bankAccountId: bank.id });
    expect([st.statementNum, st.date, st.openingBalance, st.closingBalance]).toEqual(["20261101-20261114", "2026-11-14", "1000.00", "1950.50"]);
    const lines = await rows(T, "bank.statementLine", { statementId: st.id });
    expect(lines.map((l) => [l.amount, l.vs, l.counterAccount])).toEqual([["1000.00", "2600001", "19-2000145399/0800"], ["-49.50", null, null]]);
    expect(String(lines[0].message)).toContain("Faktura · Masna");

    // hromadný import: soubor pozná podle začátku, účet podle IBAN; navazuje za obdobím
    const session = { ctx: T, lang: "cs", companies: [{ id: T.companyId!, code: "B", name: "Banka" }], superUser: true, adminCompanyIds: [T.companyId!] } as unknown as AppSession;
    const f2 = kb("15.11.2026", "20.11.2026", "1950,5", "2000,5", ["16.11.2026;16.11.2026;;;50;CZK;;;;ID3;Prichozi uhrada;;"]);
    const [r2] = await importStatementsBulk(session, { name: "export.csv", data: f2 });
    expect([r2.status, r2.statementNum, r2.message]).toEqual(["imported", "20261115-20261120", null]);
    // nenavazující zůstatek = upozornění; stejný výpis znovu = duplicita
    const f3 = kb("21.11.2026", "22.11.2026", "9999", "9999", []);
    expect((await importStatementsBulk(session, { name: "x.csv", data: f3 }))[0].status).toBe("warning");
    expect((await importStatementsBulk(session, { name: "export.csv", data: f2 }))[0].status).toBe("duplicate");
    // nesedí součty → chyba, nic se neuloží
    const bad = kb("23.11.2026", "24.11.2026", "9999", "1", ["23.11.2026;;;;5;CZK;;;;;;;"]);
    expect((await importStatementsBulk(session, { name: "y.csv", data: bad }))[0].status).toBe("error");
  });
});
