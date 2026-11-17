/** Nová účtovaná firma z ARES / VIES: firma (výchozí nastavení se spustí samo) a údaje organizace se sídlem. */
import { UserError } from "@/core/module";
import { lookupRegistry } from "@/modules/gab/registry-lookup";
import { splitPersonName } from "@/modules/gab/ares";
import { inTenant, Session, type Ctx } from "./data";
import type { PrismaClient } from "@/generated/prisma/client";
import { vatRegistryStatus } from "@/modules/gab/vat-registry";
import { czIban } from "@/core/print";
import { companyCodeFromName } from "@/modules/org/company-code";
import type { DataApi } from "@/core/module";

export function createCompanyFromRegistry(
  ctx: Ctx,
  query: string,
  client?: PrismaClient,
): Promise<string> {
  return inTenant(
    ctx,
    async (sess) => {
      const hit = await lookupRegistry(sess.sys().api(), query, "company");
      if (!hit)
        throw new UserError("@GAB:AresNotFound", { query: String(query) });
      // firma už existuje → údaje z registru se jen aktualizují
      // kód = zkratka z názvu (4 znaky), jedinečná v tenantovi; firmu jde přejmenovat i s kódem ručně
      const taken = hit.existingId ? [] : (await sess.sys().api().find("sys.company", {}, { take: 5000 })).map((c) => String(c.code));
      const code = companyCodeFromName(hit.name, taken);
      const company = hit.existingId
        ? await sess.save("sys.company", hit.existingId, { name: hit.name.slice(0, 120), regNo: hit.regNo, vatId: hit.vatId, vatPayer: !!hit.vatId, country: hit.country })
        : await sess.save("sys.company", null, {
        code,
        name: hit.name.slice(0, 120),
        regNo: hit.regNo,
        vatId: hit.vatId,
        vatPayer: !!hit.vatId,
        country: hit.country,
        currency: hit.country === "CZ" ? "CZK" : "EUR",
      });
      // registr plátců DPH (podle DIČ): plátce, finanční úřad, zveřejněné účty
      const dicDigits = hit.vatId && /^CZ\d+$/i.test(String(hit.vatId)) ? String(hit.vatId).slice(2) : null;
      const vatStatus = dicDigits ? ((await vatRegistryStatus([dicDigits]).catch(() => null))?.get(dicDigits) ?? null) : null;
      const vatPayer = vatStatus ? vatStatus.reliability !== "notFound" : !!hit.vatId;
      if (vatPayer !== !!hit.vatId) await sess.save("sys.company", String(company.id), { ...company, vatPayer });
      const companyApi = new Session(sess.tx, { ...ctx, companyId: String(company.id) }, true).api();
      // daňové parametry pro přiznání: finanční úřad z registru, typ subjektu, jméno a sídlo (perioda a územní pracoviště ručně)
      if (ctx.modules.has("tax") && vatStatus?.taxOffice) {
        const nm = splitPersonName(hit.name);
        const tp = {
          taxOfficeCode: vatStatus.taxOffice,
          subjectType: hit.person ? "F" : "P",
          firstName: hit.person ? nm.firstName : null,
          lastName: hit.person ? nm.lastName : null,
          street: hit.streetName ?? hit.street ?? null,
          houseNo: hit.houseNo ?? null,
          orientNo: hit.orientNo ?? null,
          city: hit.city ?? null,
          zipCode: hit.zipCode ?? null,
        };
        const [have] = await companyApi.find("tax.parameters", {}, { take: 1 });
        if (have) await companyApi.update("tax.parameters", String(have.id), Object.fromEntries(Object.entries(tp).filter(([k]) => k !== "taxOfficeCode" || !have.taxOfficeCode)));
        else await companyApi.create("tax.parameters", tp);
      }
      // údaje organizace nové firmy (výchozí nastavení je založilo z firmy) doplnit o sídlo a formu
      if (ctx.modules.has("org")) {
        const api = companyApi;
        const [org] = await api.find("org.entity", {}, { take: 1 });
        const values = {
          legalName: hit.name.slice(0, 120),
          legalForm: hit.person ? "natural" : "legal",
          firstName: hit.person ? splitPersonName(hit.name).firstName : null,
          lastName: hit.person ? splitPersonName(hit.name).lastName : null,
          regNo: hit.regNo,
          vatId: hit.vatId,
          vatPayer,
          street: hit.streetName ?? hit.street,
          houseNo: hit.houseNo ?? null,
          orientNo: hit.orientNo ?? null,
          city: hit.city,
          zipCode: hit.zipCode,
          country: hit.country,
          // spisová značka z ARES → soud a text zápisu na doklady sestaví organizace sama
          ...(hit.fileRef ? { fileNumber: hit.fileRef } : {}),
        };
        // bankovní účty zveřejněné v registru plátců DPH
        const published = vatStatus?.accounts ?? [];
        // do organizace první z nich (když tam účet ještě není)
        const bankAccount: string | null = (org?.bankAccount as string) ?? published.find((a) => a.accountNum)?.accountNum ?? null;
        if (org) await api.update("org.entity", String(org.id), { ...values, bankAccount });
        else await api.create("org.entity", { ...values, bankAccount });
        // a všechny do modulu Banka (chybějící; každý svůj účet hlavní knihy 221xxx)
        if (ctx.modules.has("bank")) await createBankAccounts(api, published);
      }
      return String(company.id);
    },
    client,
  );
}

/**
 * Bankovní účty firmy z registru plátců DPH do modulu Banka: jen chybějící (podle čísla účtu
 * nebo IBAN), IBAN dopočítaný; první účet na 221000, další na vlastní analytiku 221001, 221002…
 */
export async function createBankAccounts(api: DataApi, published: { accountNum: string | null; iban: string | null }[]): Promise<number> {
  const norm = (v: unknown) => String(v ?? "").replace(/\s/g, "").toUpperCase();
  const existing = await api.find("bank.account", {}, { take: 500 });
  const have = new Set(existing.flatMap((b) => [norm(b.accountNum), norm(b.iban)]).filter(Boolean));
  let n = 0;
  for (const a of published) {
    const iban = a.iban ?? czIban(a.accountNum);
    if (have.has(norm(a.accountNum)) || have.has(norm(iban))) continue;
    // účet hlavní knihy: 221000 pro první bankovní účet, další analytiky
    const used = new Set(existing.map((b) => String(b.glAccountId ?? "")));
    let gl: string | null = null;
    for (let i = 0; i < 100 && !gl; i++) {
      const num = `221${String(i).padStart(3, "0")}`;
      let [acc] = await api.find("gl.account", { accountNum: num }, { take: 1 });
      if (!acc) acc = await api.create("gl.account", { accountNum: num, name: `Bankovní účet ${a.accountNum ?? iban ?? ""}`.slice(0, 120), type: "asset", postingType: "bank", noManualEntry: true });
      if (!used.has(String(acc.id))) gl = String(acc.id);
    }
    if (!gl) break;
    const code = `BU${String(existing.length + n + 1).padStart(2, "0")}`;
    const created = await api.create("bank.account", { code, name: `Běžný účet ${a.accountNum ?? iban ?? ""}`.slice(0, 120), accountNum: a.accountNum, iban, glAccountId: gl });
    // platební metody účtu: české číslo → ABO výchozí, k tomu SEPA
    for (const [mcode, def] of [["PREVOD", !!a.accountNum], ["SEPA", !a.accountNum]] as const) {
      const [m] = await api.find("bank.paymentMethod", { code: mcode }, { take: 1 });
      if (m) await api.create("bank.accountMethod", { bankAccountId: created.id, paymentMethodId: m.id, isDefault: def });
    }
    existing.push(created);
    have.add(norm(a.accountNum));
    have.add(norm(iban));
    n++;
  }
  return n;
}
