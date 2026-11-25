/**
 * Migrace firmy ke stažení (jen superuživatel): `?kind=template` = prázdná šablona s pokyny,
 * `?kind=export` = konfigurace aktuální firmy (bez dokladů, hesel a tajných údajů), `&mode=production` = pro ostrý
 * provoz (bez testovacích napojení, ostrá zapnutá).
 */
import { getSession } from "@/server/auth";
import { exportMigration, migrationTemplate } from "@/server/migration";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return new Response(null, { status: 401 });
  if (!s.superUser) return new Response(null, { status: 403 });
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind") === "export" ? "export" : "template";
  const production = q.get("mode") === "production";
  const body = kind === "export" ? await exportMigration(s.ctx, s.lang, undefined, { production }) : migrationTemplate(s.lang);
  const ico = kind === "export" ? String(((body.firma ?? {}) as Record<string, unknown>).ico ?? "") : "";
  const name = kind === "export" ? `migrace-${ico || "firma"}-${production ? "ostry" : "test"}-${new Date().toISOString().slice(0, 10)}.json` : "migrace-sablona.json";
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
