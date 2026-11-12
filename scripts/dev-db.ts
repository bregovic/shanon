/**
 * Lokální Postgres bez Dockeru (PGlite = Postgres zkompilovaný do WASM).
 * Data v .pglite/. Spuštění: npm run db:local  → DATABASE_URL v .env:
 *   postgresql://postgres:postgres@127.0.0.1:54329/postgres?sslmode=disable
 * Jen pro vývoj — produkce běží na skutečném Postgresu.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

async function main() {
  const port = Number(process.env.PGLITE_PORT ?? 54329);
  const db = await PGlite.create(process.env.PGLITE_DIR ?? ".pglite");
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 20 });
  await server.start();
  console.log(`PGlite běží na 127.0.0.1:${port}`);

  const stop = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

void main();
