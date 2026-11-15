/** Nová účtovaná firma z ARES / VIES: firma (výchozí nastavení se spustí samo) a údaje organizace se sídlem. */
import { UserError } from "@/core/module";
import { lookupRegistry } from "@/modules/gab/registry-lookup";
import { inTenant, Session, type Ctx } from "./data";
import type { PrismaClient } from "@/generated/prisma/client";
import { vatRegistryStatus } from "@/modules/gab/vat-registry";
import { czIban } from "@/core/print";
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
      const code = String(hit.regNo ?? hit.vatId ?? "").slice(0, 20);
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
      // údaje organizace nové firmy (výchozí nastavení je založilo z firmy) doplnit o sídlo a formu
      if (ctx.modules.has("org")) {
        const api = new Session(
          sess.tx,
          { ...ctx, companyId: String(company.id) },
          true,
        ).api();
        const [org] = await api.find("org.entity", {}, { take: 1 });
        const values = {
          legalName: hit.name.slice(0, 120),
          legalForm: hit.person ? "natural" : "legal",
          firstName: hit.person ? hit.name.split(/\s+/)[0] : null,
          lastName: hit.person
            ? hit.name.split(/\s+/).slice(1).join(" ") || null
            : null,
          regNo: hit.regNo,
          vatId: hit.vatId,
          vatPayer: !!hit.vatId,
          street: hit.streetName ?? hit.street,
          houseNo: hit.houseNo ?? null,
          orientNo: hit.orientNo ?? null,
          city: hit.city,
          zipCode: hit.zipCode,
          country: hit.country,
        };
        // bankovní účty zveřejněné v registru plátců DPH
        const published =
          hit.vatId && /^CZ\d+$/i.test(String(hit.vatId))
            ? ((await vatRegistryStatus([String(hit.vatId).slice(2)]).catch(() => null))?.get(String(hit.vatId).slice(2))?.accounts ?? [])
            : [];
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
    existing.push(created);
    have.add(norm(a.accountNum));
    have.add(norm(iban));
    n++;
  }
  return n;
}
