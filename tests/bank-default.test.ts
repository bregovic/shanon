/** Výchozí bankovní účet podle měny (jeden na měnu) → faktura v EUR tiskne výchozí eurový účet; jméno osoby bez titulů. */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, listRecords, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { printJob } from "@/server/print";
import { splitPersonName } from "@/modules/gab/ares";

const client = createPrisma();
const run = Date.now().toString(36);

describe("výchozí bankovní účet podle měny", () => {
  it("jeden výchozí na měnu, faktura bere výchozí účet své měny", async () => {
    const T = (await provisionTenant(client, { code: `t-bd-${run}`, name: "BD", adminEmail: `bd-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "bank", "prt", "org"], company: { code: "B", name: "B" } })).ctx;
    const [eur] = (await listRecords(T, "sys.currency", { filters: { code: "EUR" } }, client)).rows;
    await saveRecord(T, "sys.exchangeRate", null, { currencyId: eur.id, date: "2026-11-01", amount: 1, rate: "24.5", base: "CZK", source: "cnb" }, undefined, client);
    const gl = (await listRecords(T, "gl.account", { filter: { accountNum: "221000" } }, client)).rows[0];
    const mk = (code: string, accountNum: string, currencyId: unknown, isDefault: boolean) => saveRecord(T, "bank.account", null, { code, name: code, accountNum, currencyId, glAccountId: gl.id, isDefault }, undefined, client);
    const czk = await mk("CZK1", "123456789/0100", null, true);
    const e1 = await mk("EUR1", "1111111111/2010", eur.id, true);
    const e2 = await mk("EUR2", "2200684135/2010", eur.id, true);
    // jen jeden výchozí eurový, korunový zůstal
    expect([(await getRecord(T, "bank.account", String(e1.id), client))!.isDefault, (await getRecord(T, "bank.account", String(czk.id), client))!.isDefault]).toEqual([false, true]);
    const subj = await saveRecord(T, "gab.subject", null, { name: "Intel" }, undefined, client);
    const cust = await saveRecord(T, "ar.customer", null, { subjectId: subj.id, groupId: (await listRecords(T, "ar.group", {}, client)).rows[0].id }, undefined, client);
    const acc = async (currencyId: unknown) => {
      const inv = await saveRecord(T, "ar.invoice", null, { customerId: cust.id, invoiceDate: "2026-11-05", currencyId }, undefined, client);
      await saveRecord(T, "ar.invoiceLine", null, { invoiceId: inv.id, description: "Služba", qty: "1", unitPrice: "100" }, undefined, client);
      return ((await printJob(T, "ar.invoice", String(inv.id), null, client)).data as { company: { bankAccount: string } }).company.bankAccount;
    };
    expect(await acc(eur.id)).toBe(e2.accountNum);
    expect(await acc(null)).toBe("123456789/0100");
  }, 120_000);

  it("jméno fyzické osoby bez titulů", () => {
    expect(splitPersonName("Bc. Václav Král")).toEqual({ firstName: "Václav", lastName: "Král" });
    expect(splitPersonName("Ing. Jana Nováková, Ph.D.")).toEqual({ firstName: "Jana", lastName: "Nováková" });
  });
});
