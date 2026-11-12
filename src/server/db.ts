import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

export function createPrisma(url = process.env.DATABASE_URL) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

const g = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Klient pro systémové tabulky (přihlášení, moduly, tenanti).
 * K datům objektů se přistupuje výhradně přes withTenant().
 */
export const prisma = g.prisma ?? createPrisma();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;

/**
 * Transakce v kontextu tenanta: role bez práv obejít RLS + id tenanta
 * pro politiky. Vše uvnitř vidí jen data daného tenanta.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
  client: PrismaClient = prisma,
): Promise<T> {
  return client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE shanon_app");
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    },
    { timeout: 20_000 },
  );
}
