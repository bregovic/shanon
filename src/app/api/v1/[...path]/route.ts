/**
 * REST API Shanonu (v1). Autorizace: `Authorization: Bearer shn.…` (klíč
 * z Integrace → Napojení druhu API). Rozsah klíče = moduly / objekty.
 *
 *   GET   /api/v1                       informace o klíči (rozsah, firma)
 *   GET   /api/v1/<objekt>?field=hodnota&q=&sort=&dir=&page=&pageSize=
 *   GET   /api/v1/<objekt>/<id>
 *   POST  /api/v1/<objekt>               založení (JSON)
 *   PATCH /api/v1/<objekt>/<id>          úprava (JSON, jen uvedená pole)
 *   POST  /api/v1/<objekt>/<id>/<akce>   akce záznamu (Zaúčtovat…)
 *
 * Mazání přes API není. Chyby: 400 { error, fields }, 401, 403, 404.
 */
import { UserError, type RecordData } from "@/core/module";
import { fillLabel, resolveLabel } from "@/core/labels";
import { labelTable, registry } from "@/registry";
import { apiContext } from "@/server/api";
import { getRecord, listRecords, runAction, saveRecord } from "@/server/data";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const txt = (ref: string, params?: Record<string, string>) => fillLabel(resolveLabel(labelTable, ref, "cs"), params);

async function handle(req: Request, path: string[], method: "GET" | "POST" | "PATCH") {
  const auth = await apiContext(req.headers.get("authorization"));
  if (!auth) return json({ error: "Neplatný nebo neaktivní klíč API." }, 401);
  const { ctx, scopes } = auth;
  const [objectId, id, action] = path;
  try {
    if (!objectId) return json({ scopes, companyId: ctx.companyId, objects: [...registry.objects.values()].filter((o) => scopes.some((s) => s === o.id || o.id.startsWith(`${s}.`))).map((o) => ({ id: o.id, fields: Object.keys(o.fields) })) });
    const def = registry.objects.get(objectId);
    if (!def) return json({ error: "Neznámý objekt." }, 404);
    if (method === "GET" && !id) {
      const u = new URL(req.url);
      const filter: RecordData = {};
      for (const [k, v] of u.searchParams) if (k in def.fields) filter[k] = v;
      const r = await listRecords(ctx, objectId, {
        filter,
        q: u.searchParams.get("q") ?? undefined,
        sort: u.searchParams.get("sort") ?? undefined,
        dir: u.searchParams.get("dir") === "desc" ? "desc" : "asc",
        page: Number(u.searchParams.get("page") ?? 1),
        pageSize: Math.min(Number(u.searchParams.get("pageSize") ?? 100), 200),
      });
      return json({ total: r.total, page: r.page, rows: r.rows });
    }
    if (method === "GET") {
      const r = await getRecord(ctx, objectId, id);
      return r ? json(r) : json({ error: "Záznam nenalezen." }, 404);
    }
    if (method === "POST" && id && action) {
      await runAction(ctx, objectId, id, action);
      return json(await getRecord(ctx, objectId, id));
    }
    const body = (await req.json().catch(() => null)) as RecordData | null;
    if (!body || typeof body !== "object") return json({ error: "Tělo musí být JSON objekt." }, 400);
    if (method === "POST" && !id) return json(await saveRecord(ctx, objectId, null, body), 201);
    if (method === "PATCH" && id) return json(await saveRecord(ctx, objectId, id, body));
    return json({ error: "Nepodporovaná operace." }, 405);
  } catch (e) {
    if (e instanceof UserError) {
      const status = e.label === "@SYS:NoAccess" ? 403 : e.label === "@SYS:NotFound" ? 404 : 400;
      return json({ error: txt(e.label, e.params), fields: Object.fromEntries(Object.entries(e.fields ?? {}).map(([k, v]) => [k, txt(String(v))])) }, status);
    }
    throw e;
  }
}

type P = { params: Promise<{ path?: string[] }> };
export const GET = async (req: Request, { params }: P) => handle(req, (await params).path ?? [], "GET");
export const POST = async (req: Request, { params }: P) => handle(req, (await params).path ?? [], "POST");
export const PATCH = async (req: Request, { params }: P) => handle(req, (await params).path ?? [], "PATCH");
