/** Nová účtovaná firma z ARES / VIES: firma (výchozí nastavení se spustí samo) a údaje organizace se sídlem. */
import { UserError } from "@/core/module";
import { lookupRegistry } from "@/modules/gab/registry-lookup";
import { aresNace, naceFields, splitPersonName } from "@/modules/gab/ares";
import { inTenant, Session, type Ctx } from "./data";
import type { PrismaClient } from "@/generated/prisma/client";
import { vatRegistryStatus } from "@/modules/gab/vat-registry";
import { createBankAccounts } from "@/modules/bank/registry-accounts";
import { companyCodeFromName } from "@/modules/org/company-code";

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
      // moduly organizace (ne nové firmy): daňové parametry a účty Banky se předvyplní i firmě, která modul zapne až později
      const has = (m: string) => ctx.modules.has(m);
      // činnosti podle CZ-NACE (výpadek RES založení nezastaví)
      const nace = hit.regNo && hit.source === "ares" ? await aresNace(hit.regNo, sess.sys().api()).catch(() => null) : null;
      // daňové parametry pro přiznání: finanční úřad z registru, typ subjektu, jméno a sídlo (perioda a územní pracoviště ručně)
      if (has("tax") && vatStatus?.taxOffice) {
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
      if (has("org")) {
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
          ...(nace ? naceFields(nace) : {}),
        };
        // bankovní účty zveřejněné v registru plátců DPH
        const published = vatStatus?.accounts ?? [];
        // do organizace první z nich (když tam účet ještě není)
        const bankAccount: string | null = (org?.bankAccount as string) ?? published.find((a) => a.accountNum)?.accountNum ?? null;
        if (org) await api.update("org.entity", String(org.id), { ...values, bankAccount });
        else await api.create("org.entity", { ...values, bankAccount });
        // a všechny do modulu Banka (chybějící; každý svůj účet hlavní knihy 221xxx)
        if (has("bank")) await createBankAccounts(api, published);
      }
      return String(company.id);
    },
    client,
  );
}
