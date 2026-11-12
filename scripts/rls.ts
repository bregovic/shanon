/**
 * Row Level Security pro všechny tabulky objektů. Idempotentní, spouští se
 * po každé migraci (npm run db:deploy).
 *
 * Aplikace přistupuje k datům objektů vždy v transakci s
 *   SET LOCAL ROLE shanon_app; set_config('app.tenant_id', …, true)
 * (src/server/db.ts). Role shanon_app není vlastník tabulek ani superuser,
 * takže na ni politiky platí — ani chyba v kódu nevrátí data jiného tenanta.
 */
import "dotenv/config";
import { Client } from "pg";
import { registry } from "../src/registry";

export const APP_ROLE = "shanon_app";

export function rlsStatements(): string[] {
  const tables = [...[...registry.objects.values()].map((o) => o.table), "sys_audit", "sys_docuref", "sys_file_blob"];
  const sql: string[] = [
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
         CREATE ROLE ${APP_ROLE} NOLOGIN;
       END IF;
     END $$;`,
    `GRANT USAGE ON SCHEMA public TO ${APP_ROLE};`,
  ];
  for (const t of tables) {
    sql.push(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON "${t}" TO ${APP_ROLE};`,
      `ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY;`,
      `DROP POLICY IF EXISTS tenant_isolation ON "${t}";`,
      `CREATE POLICY tenant_isolation ON "${t}"
         USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
         WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);`,
    );
  }
  return sql;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const s of rlsStatements()) await client.query(s);
    await client.query("COMMIT");
    console.log(`RLS: ${registry.objects.size + 3} tabulek`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
