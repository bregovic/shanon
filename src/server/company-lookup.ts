/** Nová účtovaná firma z ARES / VIES: firma (výchozí nastavení se spustí samo) a údaje organizace se sídlem. */
import { UserError } from "@/core/module";
import { lookupRegistry } from "@/modules/gab/registry-lookup";
import { inTenant, Session, type Ctx } from "./data";
import type { PrismaClient } from "@/generated/prisma/client";

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
        // bankovní účet: první zveřejněný v registru plátců DPH (když v organizaci chybí)
        let bankAccount: string | null = (org?.bankAccount as string) ?? null;
        if (!bankAccount && hit.vatId && /^CZ\d+$/i.test(String(hit.vatId))) {
          const { vatRegistryStatus } = await import("@/modules/gab/vat-registry");
          const st = await vatRegistryStatus([String(hit.vatId).slice(2)]).catch(() => null);
          bankAccount = st?.get(String(hit.vatId).slice(2))?.accounts.find((a) => a.accountNum)?.accountNum ?? null;
        }
        if (org) await api.update("org.entity", String(org.id), { ...values, bankAccount });
        else await api.create("org.entity", { ...values, bankAccount });
      }
      return String(company.id);
    },
    client,
  );
}
