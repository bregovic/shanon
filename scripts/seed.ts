/**
 * Ukázkový tenant pro vývoj. Heslo správce z SEED_PASSWORD (jinak náhodné, vypíše se).
 * Spuštění: npm run db:seed
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createPrisma } from "../src/server/db";
import { provisionTenant } from "../src/server/provision";

async function main() {
  const client = createPrisma();
  const code = process.env.SEED_TENANT ?? "demo";
  if (await client.sysTenant.findUnique({ where: { code } })) {
    console.log(`Tenant ${code} už existuje.`);
    return client.$disconnect();
  }
  const password = process.env.SEED_PASSWORD ?? randomBytes(9).toString("base64url");
  const email = process.env.SEED_EMAIL ?? "admin@shanon.local";
  await provisionTenant(client, {
    code,
    name: "Demo s.r.o.",
    adminEmail: email,
    adminPassword: password,
    modules: ["gab", "gl", "tax"],
    company: { code: "DEMO", name: "Demo s.r.o.", regNo: "12345678", vatId: "CZ12345678" },
  });
  console.log(`Tenant ${code}: ${email} / ${process.env.SEED_PASSWORD ? "(SEED_PASSWORD)" : password}`);
  await client.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
