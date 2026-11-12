/**
 * Založení tenanta: tenant, správce, moduly, první firma a základní
 * nastavení (číselné řady, účtový rozvrh, DPH). Používá seed i testy.
 */
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@/generated/prisma/client";
import { dependencyClosure } from "@/core/module";
import { VOUCHER_SEQ } from "@/modules/gl/posting";
import { registry } from "@/registry";
import { inTenant, type Ctx } from "./data";

export interface ProvisionInput {
  code: string;
  name: string;
  adminEmail: string;
  adminPassword: string;
  modules: string[];
  company: { code: string; name: string; regNo?: string; vatId?: string };
}

/** Výřez směrné účtové osnovy pro start (firma si ho doplní). */
const ACCOUNTS: [string, string, string][] = [
  ["211", "Pokladna", "asset"],
  ["221", "Bankovní účty", "asset"],
  ["311", "Odběratelé", "asset"],
  ["321", "Dodavatelé", "liability"],
  ["343", "Daň z přidané hodnoty", "liability"],
  ["411", "Základní kapitál", "equity"],
  ["501", "Spotřeba materiálu", "expense"],
  ["518", "Ostatní služby", "expense"],
  ["604", "Tržby za zboží", "revenue"],
  ["602", "Tržby z prodeje služeb", "revenue"],
];

export async function provisionTenant(client: PrismaClient, input: ProvisionInput) {
  const modules = dependencyClosure(registry, ["sys", ...input.modules]);
  const tenant = await client.sysTenant.create({
    data: {
      code: input.code,
      name: input.name,
      modules: { create: [...modules].map((moduleId) => ({ moduleId })) },
      users: {
        create: {
          email: input.adminEmail.toLowerCase(),
          name: "Správce",
          role: "admin",
          passwordHash: await bcrypt.hash(input.adminPassword, 12),
        },
      },
    },
    include: { users: true },
  });
  const ctx: Ctx = {
    tenantId: tenant.id,
    userId: tenant.users[0].id,
    companyId: null,
    role: "admin",
    modules,
    extensions: new Set(),
  };
  const company = await inTenant(ctx, (s) => s.save("sys.company", null, input.company), client);
  const cctx: Ctx = { ...ctx, companyId: String(company.id) };

  await inTenant(
    cctx,
    async (s) => {
      if (modules.has("gl")) {
        await s.save("sys.numberSeq", null, { code: VOUCHER_SEQ, name: "Účetní doklady", format: "UD{YY}-{######}" });
        await s.save("sys.numberSeq", null, { code: "GLJOURNAL", name: "Účetní deníky", format: "DEN{YY}-{#####}" });
        for (const [accountNum, name, type] of ACCOUNTS) await s.save("gl.account", null, { accountNum, name, type });
      }
      if (modules.has("tax")) {
        const [vat] = await s.find("gl.account", { accountNum: "343" });
        const codes = [
          ["V21", "DPH na výstupu 21 %", "21", "output", "1", "A4"],
          ["V12", "DPH na výstupu 12 %", "12", "output", "2", "A4"],
          ["P21", "DPH na vstupu 21 %", "21", "input", "40", "B2"],
          ["P12", "DPH na vstupu 12 %", "12", "input", "41", "B2"],
        ];
        for (const [code, name, rate, direction, reportLine, khSection] of codes) {
          await s.save("tax.taxCode", null, { code, name, rate, direction, accountId: vat.id, reportLine, khSection });
        }
      }
    },
    client,
  );
  return { tenant, company, ctx: cctx };
}
