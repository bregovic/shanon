/**
 * Start serveru: plánovač dávkových úloh (src/server/batch.ts).
 * Vypnutí: BATCH_SCHEDULER=off (např. další instance nebo ladění).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.BATCH_SCHEDULER === "off" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startScheduler } = await import("./server/batch");
  startScheduler();
}
