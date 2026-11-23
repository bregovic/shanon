/**
 * Rozhraní tiskové stanice (Shanon Pokladna pro Windows), bez přihlášení — klíč stanice v hlavičce
 * `Authorization: Bearer shs.…` (src/server/station.ts).
 *
 *   POST /api/station/pair              { code, host, version } → { token, deviceId, name } (kód z instalátoru)
 *   POST /api/station/hello             { host, version, printers: [{ name, default }] }
 *   GET  /api/station/jobs?wait=25      úlohy k tisku (čeká, dokud nějaká nepřijde)
 *   GET  /api/station/jobs/<id>/pdf     PDF úlohy, nastavení tisku v hlavičce X-Print-Settings
 *   POST /api/station/jobs/<id>         { ok, message } výsledek tisku
 */
import { UserError } from "@/core/module";
import { fillLabel, resolveLabel } from "@/core/labels";
import { labelTable } from "@/registry";
import { jobPdf, pairStation, reportJob, stationAuth, stationHello, takeJobs } from "@/server/station";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const UUID = /^[0-9a-f-]{36}$/;

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function fail(e: unknown) {
  if (e instanceof UserError) return json({ error: fillLabel(resolveLabel(labelTable, e.label, "cs"), e.params) }, 400);
  console.error("[station]", e);
  return json({ error: "Chyba serveru." }, 500);
}

export async function POST(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const path = (await params).path ?? [];
  try {
    if (path[0] === "pair" && path.length === 1) {
      const b = await body(req);
      const r = await pairStation(String(b.code ?? ""), { host: b.host ? String(b.host) : undefined, version: b.version ? String(b.version) : undefined });
      return r ? json(r) : json({ error: "Párovací kód neplatí — stáhněte v Shanonu instalaci znovu (Integrace → Zařízení)." }, 401);
    }
    const st = await stationAuth(req.headers.get("authorization"));
    if (!st) return json({ error: "Stanice není spárovaná nebo je vypnutá." }, 401);
    if (path[0] === "hello" && path.length === 1) {
      const b = await body(req);
      await stationHello(st, { host: b.host ? String(b.host) : undefined, version: b.version ? String(b.version) : undefined, printers: Array.isArray(b.printers) ? (b.printers as { name: string; default?: boolean }[]) : [] });
      return json({ ok: true });
    }
    if (path[0] === "jobs" && path.length === 2 && UUID.test(path[1])) {
      const b = await body(req);
      await reportJob(st, path[1], b.ok === true, b.message ? String(b.message) : undefined);
      return json({ ok: true });
    }
    return json({ error: "Neznámá adresa." }, 404);
  } catch (e) {
    return fail(e);
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const path = (await params).path ?? [];
  try {
    const st = await stationAuth(req.headers.get("authorization"));
    if (!st) return json({ error: "Stanice není spárovaná nebo je vypnutá." }, 401);
    if (path[0] === "jobs" && path.length === 1) {
      const wait = Number(new URL(req.url).searchParams.get("wait") ?? 0) || 0;
      return json({ jobs: await takeJobs(st, wait) });
    }
    if (path[0] === "jobs" && path.length === 3 && UUID.test(path[1]) && path[2] === "pdf") {
      const r = await jobPdf(st, path[1]);
      return new Response(new Uint8Array(r.pdf), {
        headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store", "X-Print-Settings": r.settings },
      });
    }
    return json({ error: "Neznámá adresa." }, 404);
  } catch (e) {
    return fail(e);
  }
}
