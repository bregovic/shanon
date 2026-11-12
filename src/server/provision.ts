/**
 * Založení tenanta: tenant, správce, moduly a první firma. Výchozí nastavení
 * firmy (číselné řady, účtový rozvrh, DPH…) doplní moduly samy při jejím
 * založení (src/server/setup.ts). Používá seed i testy.
 */
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@/generated/prisma/client";
import { dependencyClosure } from "@/core/module";
import { ADMIN } from "@/core/security";
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
    perms: ADMIN,
    modules,
    extensions: new Set(),
  };
  const company = await inTenant(ctx, (s) => s.save("sys.company", null, input.company), client);
  const cctx: Ctx = { ...ctx, companyId: String(company.id) };

  return { tenant, company, ctx: cctx };
}
