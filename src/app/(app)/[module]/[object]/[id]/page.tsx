import { notFound } from "next/navigation";
import { ObjectDetailView, type LineSpec } from "@/components/object-detail-view";
import type { RecordData } from "@/core/module";
import { coerce } from "@/core/validate";
import { registry } from "@/registry";
import { requireSession } from "@/server/auth";
import { getRecord, listRecords } from "@/server/data";
import { duplicateRecord } from "@/server/duplicate";
import { printableObjectIds } from "@/server/print";
import { getT } from "@/server/i18n";
import { fieldsMeta, formGroups, hiddenFields, objectHref, uiLabels } from "@/server/ui";
import { can } from "@/core/security";

type Params = { module: string; object: string; id: string };

export default async function ObjectDetailPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ copy?: string }> }) {
  const { module, object, id } = await params;
  const { copy } = await searchParams;
  const s = await requireSession();
  const def = registry.objects.get(`${module}.${object}`);
  if (!def || !s.ctx.modules.has(module)) notFound();
  if (def.scope === "company" && !s.ctx.companyId) notFound();
  if (!can(s.ctx.perms, def.id, "read")) notFound();
  const mayWrite = can(s.ctx.perms, def.id, "write");
  const t = await getT(s.lang, s.ctx.tenantId);
  const meta = fieldsMeta(s.ctx, def, t);
  const isNew = id === "new";
  if (isNew && (def.systemOnly || !mayWrite)) notFound();

  const defaults = (d: typeof def) => {
    const out: RecordData = {};
    for (const [n, f] of Object.entries(d.fields)) if (f.default !== undefined) out[n] = coerce(f.edt, f.default === "$today" ? new Date().toISOString().slice(0, 10) : f.default, registry)[0];
    return out;
  };

  let record: RecordData;
  if (isNew) {
    record = { ext: {}, ...defaults(def) };
    // Duplikovat: hodnoty zdrojového záznamu bez klíče
    const dup = copy ? await duplicateRecord(s.ctx, def.id, copy) : null;
    if (dup && "values" in dup) record = { ...record, ...dup.values, _titles: dup.titles };
  }
  else {
    const r = await getRecord(s.ctx, def.id, id);
    if (!r) notFound();
    record = r;
  }

  const locked = !isNew && !!def.lockedWhen && record[def.lockedWhen.field] === def.lockedWhen.equals;
  const readOnly = !!def.systemOnly || locked || !mayWrite;
  const recordTitle = isNew ? `${t("@SYS:New")} · ${t(def.label)}` : String(record[def.titleField] ?? t(def.label));
  const mod = registry.modules.get(module)!;

  const lines: LineSpec[] = isNew
    ? []
    : await Promise.all(
        (def.lines ?? [])
          .filter((l) => s.ctx.modules.has(l.object.split(".")[0]))
          .map(async (l) => {
            const ld = registry.objects.get(l.object)!;
            const lm = fieldsMeta(s.ctx, ld, t);
            const initial = await listRecords(s.ctx, ld.id, { filter: { [l.field]: id }, pageSize: 100, lang: s.lang, totals: true });
            return {
              objectId: ld.id,
              field: l.field,
              label: t(l.label),
              titleField: ld.titleField,
              columns: ld.list.filter((f) => f !== l.field && !hiddenFields(s.ctx, ld).includes(f)).map((f) => lm[f]),
              groups: formGroups(s.ctx, ld, t, lm, [l.field]),
              defaults: defaults(ld),
              // přehled samostatných dokladů (výpisy účtu, faktury odběratele): jen otevřít
              overview: l.owned === false || !!ld.systemOnly,
              inline: !!l.inline,
              sortField: ld.defaultSort?.field,
              editable: l.owned !== false && !ld.systemOnly && !locked && can(s.ctx.perms, ld.id, "write"),
              initial: { rows: initial.rows, total: initial.total, totals: initial.totals },
            };
          }),
      );

  return (
    <ObjectDetailView
      key={`${id}:${record.version ?? 0}`}
      objectId={def.id}
      id={isNew ? null : id}
      crumbs={[
        { label: t(mod.label), href: `/${module}` },
        { label: t(def.labelPlural), href: objectHref(def.id) },
      ]}
      groups={formGroups(s.ctx, def, t, meta)}
      values={{ ...record, ...((record.ext as RecordData) ?? {}) }}
      titles={(record._titles as Record<string, string>) ?? {}}
      version={record.version as number | undefined}
      recordTitle={recordTitle}
      readOnly={readOnly}
      canAttach={mayWrite}
      canDelete={!isNew && !readOnly && can(s.ctx.perms, def.id, "delete")}
      canDuplicate={!isNew && !def.systemOnly && mayWrite}
      compactHeader={!!def.compactHeader}
      printHref={!isNew && s.ctx.modules.has("prt") && printableObjectIds().has(def.id) ? `/print/${def.id}/${id}` : undefined}
      actions={
        isNew || !mayWrite
          ? []
          : (def.actions ?? []).filter((a) => (!a.when || record[a.when.field] === a.when.equals) && (!a.module || s.ctx.modules.has(a.module))).map((a) => ({ id: a.id, label: t(a.label), upload: a.upload, download: a.download }))
      }
      lines={lines}
      lang={s.lang}
      labels={uiLabels(t)}
    />
  );
}
