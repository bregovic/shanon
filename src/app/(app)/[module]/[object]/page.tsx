import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { ObjectGrid } from "@/components/object-grid";
import { registry } from "@/registry";
import { requireSession } from "@/server/auth";
import { listRecords } from "@/server/data";
import { getT } from "@/server/i18n";
import { fieldsMeta, objectHref } from "@/server/ui";

type Params = { module: string; object: string };
type Search = { q?: string; sort?: string; dir?: string; page?: string };

export default async function ObjectListPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const { module, object } = await params;
  const sp = await searchParams;
  const s = await requireSession();
  const def = registry.objects.get(`${module}.${object}`);
  if (!def || !s.ctx.modules.has(module)) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);

  if (def.scope === "company" && !s.ctx.companyId) {
    return <p className="text-sm text-muted">{t("@SYS:NoCompany")}</p>;
  }

  const meta = fieldsMeta(s.ctx, def, t);
  const result = await listRecords(s.ctx, def.id, {
    q: sp.q,
    sort: sp.sort,
    dir: sp.dir === "desc" ? "desc" : sp.dir === "asc" ? "asc" : undefined,
    page: Number(sp.page) || 1,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">{t(def.labelPlural)}</h1>
        <form className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
          <input name="q" defaultValue={sp.q} placeholder={t("@SYS:Search")} className="input w-56 pl-8" />
          {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
          {sp.dir && <input type="hidden" name="dir" value={sp.dir} />}
        </form>
        {!def.systemOnly && (
          <Link href={objectHref(def.id, "new")} className="btn btn-primary">
            <Plus className="h-4 w-4" />
            {t("@SYS:New")}
          </Link>
        )}
      </div>
      <ObjectGrid
        objectId={def.id}
        columns={def.list.map((f) => meta[f])}
        result={result}
        lang={s.lang}
        query={{ q: sp.q, sort: sp.sort, dir: sp.dir }}
        labels={{ empty: t("@SYS:Empty"), records: t("@SYS:Records"), previous: t("@SYS:Previous"), next: t("@SYS:Next") }}
      />
    </div>
  );
}
