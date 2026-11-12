import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { ObjectForm } from "@/components/object-form";
import { ObjectGrid } from "@/components/object-grid";
import type { RecordData } from "@/core/module";
import { registry } from "@/registry";
import { requireSession } from "@/server/auth";
import { extFields, getRecord, listRecords } from "@/server/data";
import { getT } from "@/server/i18n";
import { fieldsMeta, objectHref } from "@/server/ui";

type Params = { module: string; object: string; id: string };

/** jen interní cesty, ať odkaz "zpět" nejde zneužít k přesměrování ven */
const safeBack = (b?: string) => (b && b.startsWith("/") && !b.startsWith("//") ? b : undefined);

export default async function ObjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { module, object, id } = await params;
  const sp = await searchParams;
  const s = await requireSession();
  const def = registry.objects.get(`${module}.${object}`);
  if (!def || !s.ctx.modules.has(module)) notFound();
  if (def.scope === "company" && !s.ctx.companyId) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  const meta = fieldsMeta(s.ctx, def, t);
  const isNew = id === "new";
  if (isNew && def.systemOnly) notFound();

  let record: RecordData;
  if (isNew) {
    record = { ext: {} };
    for (const [n, f] of Object.entries(def.fields)) {
      // předvyplnění z odkazu (např. nový řádek dokladu: ?journalId=…)
      record[n] = sp[n] ?? f.default ?? null;
    }
  } else {
    const r = await getRecord(s.ctx, def.id, id);
    if (!r) notFound();
    record = r;
  }

  const locked = !isNew && !!def.lockedWhen && record[def.lockedWhen.field] === def.lockedWhen.equals;
  const readOnly = !!def.systemOnly || locked;
  const back = safeBack(sp.back);
  const values: Record<string, unknown> = { ...record, ...((record.ext as RecordData) ?? {}) };
  const titles = { ...((record._titles as Record<string, string>) ?? {}) };
  if (isNew) {
    // název předvyplněného odkazu (rodič řádku)
    for (const [n, f] of Object.entries(def.fields)) {
      if (f.edt.kind !== "ref" || !sp[n]) continue;
      const target = registry.objects.get(f.edt.refObject!)!;
      const r = await getRecord(s.ctx, target.id, sp[n]!);
      if (r) titles[n] = String(r[target.titleField] ?? "");
      else record[n] = null;
    }
  }
  const groups = def.form.map((g) => ({ label: t(g.label), fields: g.fields.map((n) => meta[n]) }));
  const ext = Object.keys(extFields(s.ctx, def.id));
  if (ext.length) groups.push({ label: t("@SYS:ExtensionFields"), fields: ext.map((n) => meta[n]) });

  const actions = isNew
    ? []
    : (def.actions ?? [])
        .filter((a) => !a.when || record[a.when.field] === a.when.equals)
        .map((a) => ({ id: a.id, label: t(a.label) }));

  const title = isNew ? `${t("@SYS:New")} · ${t(def.label)}` : String(record[def.titleField] ?? t(def.label));
  const here = objectHref(def.id, isNew ? undefined : id);

  const lines = isNew
    ? []
    : await Promise.all(
        (def.lines ?? [])
          .filter((l) => s.ctx.modules.has(l.object.split(".")[0]))
          .map(async (l) => {
            const ld = registry.objects.get(l.object)!;
            const lmeta = fieldsMeta(s.ctx, ld, t);
            const result = await listRecords(s.ctx, ld.id, { filter: { [l.field]: id }, pageSize: 200, sort: ld.defaultSort?.field });
            return { l, ld, columns: ld.list.filter((f) => f !== l.field).map((f) => lmeta[f]), result };
          }),
      );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href={back ?? objectHref(def.id)} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" />
          {t(def.labelPlural)}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
      </div>

      <ObjectForm
        objectId={def.id}
        id={isNew ? null : id}
        version={record.version as number | undefined}
        back={back}
        groups={groups}
        values={values}
        titles={titles}
        readOnly={readOnly}
        canDelete={!isNew && !readOnly}
        actions={actions}
        justSaved={sp.saved === "1"}
        labels={{ save: t("@SYS:Save"), delete: t("@SYS:Delete"), saved: t("@SYS:Saved"), search: t("@SYS:Search") }}
      />

      {lines.map(({ l, ld, columns, result }) => (
        <section key={l.object} className="space-y-3">
          <div className="flex items-center">
            <h2 className="mr-auto text-lg font-semibold">{t(l.label)}</h2>
            {!ld.systemOnly && !locked && (
              <Link href={`${objectHref(ld.id, "new")}?${l.field}=${id}&back=${encodeURIComponent(here)}`} className="btn">
                <Plus className="h-4 w-4" />
                {t("@SYS:New")}
              </Link>
            )}
          </div>
          <ObjectGrid
            objectId={ld.id}
            columns={columns}
            result={result}
            lang={s.lang}
            query={null}
            back={here}
            labels={{ empty: t("@SYS:Empty"), records: t("@SYS:Records"), previous: t("@SYS:Previous"), next: t("@SYS:Next") }}
          />
        </section>
      ))}
    </div>
  );
}
