/**
 * Rozhraní tiskové stanice (Shanon Pokladna pro Windows), bez přihlášení — klíč stanice v hlavičce
 * `Authorization: Bearer shs.…` (src/server/station.ts).
 *
 *   POST /api/station/pair              { code, host, version } → { token, deviceId, name } (kód z instalátoru)
 *   POST /api/station/hello             { host, version, printers: [{ name, default, state, queued, driver }], usb: [název] }
 *   GET  /api/station/jobs?wait=25      úlohy k tisku (čeká, dokud nějaká nepřijde)
 *   GET  /api/station/jobs/<id>/pdf     PDF úlohy, nastavení tisku v hlavičce X-Print-Settings
 *   GET  /api/station/installer/<kód>             Shanon-instalace.exe (párovací kód v adrese = odkaz z Nastavení / Zařízení)
 *   GET  /api/station/installer/<kód>/setup.ps1   instalační skript, který si instalátor stáhne
 *   POST /api/station/jobs/<id>         { ok, message } výsledek tisku
 *   GET  /api/station/agent             program stanice (samoaktualizace, když úlohy hlásí novější `agent`)
 */
import { UserError } from "@/core/module";
import { fillLabel, resolveLabel } from "@/core/labels";
import { labelTable } from "@/registry";
import { type HelloPrinter, jobPdf, pairStation, reportJob, stationAuth, stationHello, stationInstallerFile, takeJobs, helloWanted, stationAgentFile, stationAgentVersion } from "@/server/station";

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
      await stationHello(st, {
        host: b.host ? String(b.host) : undefined,
        version: b.version ? String(b.version) : undefined,
        printers: Array.isArray(b.printers) ? (b.printers as HelloPrinter[]) : [],
        // stanice 1.2+: USB tiskárny bez ovladače (starší pole neposílá → beze změny)
        usb: Array.isArray(b.usb) ? (b.usb as unknown[]).map(String) : undefined,
      });
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
    // instalace (bez klíče stanice — tajemstvím je párovací kód v adrese)
    if (path[0] === "installer" && (path.length === 2 || (path.length === 3 && path[2] === "setup.ps1"))) {
      const file = await stationInstallerFile(path[1], path.length === 2 ? "exe" : "script");
      if (!file)
        return new Response("Odkaz na instalaci už neplatí (platí 3 dny a jen jednou). V Shanonu klikněte znovu na Nainstalovat.", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
      return new Response(new Uint8Array(file), {
        headers:
          path.length === 2
            ? { "Content-Type": "application/x-msdownload", "Content-Disposition": 'attachment; filename="Shanon-instalace.exe"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
            : { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    const st = await stationAuth(req.headers.get("authorization"));
    if (!st) return json({ error: "Stanice není spárovaná nebo je vypnutá." }, 401);
    if (path[0] === "jobs" && path.length === 1) {
      const wait = Number(new URL(req.url).searchParams.get("wait") ?? 0) || 0;
      const jobs = await takeJobs(st, wait);
      // agent = verze programu v Shanonu (starší stanice se aktualizuje), hello = poslat hned tiskárny a stav
      return json({ jobs, agent: stationAgentVersion(), hello: await helloWanted(st) });
    }
    if (path[0] === "agent" && path.length === 1) {
      return new Response(new Uint8Array(stationAgentFile()), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
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
