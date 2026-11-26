import { helpFor } from "@/server/help";
import { notFound, redirect } from "next/navigation";
import { ObjectDetailView, type LineSpec } from "@/components/object-detail-view";
import type { RecordData } from "@/core/module";
import { coerce } from "@/core/validate";
import { registry } from "@/registry";
import { requireSession } from "@/server/auth";
import { inTenant, getRecord, listRecords } from "@/server/data";
import { duplicateRecord } from "@/server/duplicate";
import { directPrintObjectIds, printableObjectIds } from "@/server/print";
import { getT } from "@/server/i18n";
import { fieldsMeta, formGroups, hiddenFields, objectHref, uiLabels } from "@/server/ui";
import { can } from "@/core/security";
import { workflowBar } from "@/server/workflow-bar";
import type { WorkflowBarLabels } from "@/components/workflow-bar";

type Params = { module: string; object: string; id: string };

export default async function ObjectDetailPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { module, object, id } = await params;
  const sp = await searchParams;
  const copy = sp.copy;
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
  let dup: Awaited<ReturnType<typeof duplicateRecord>> = null;
  if (isNew) {
    record = { ext: {}, ...defaults(def) };
    // Duplikovat: hodnoty zdrojového záznamu bez klíče
    dup = copy ? await duplicateRecord(s.ctx, def.id, copy) : null;
    if (dup && "values" in dup) record = { ...record, ...dup.values, _titles: dup.titles };
    // hodnoty z filtru seznamu (?set.pole=hodnota) — jen jednoduchá upravitelná pole (poslední hodnoty až po nich)
    for (const [k, v] of Object.entries(sp)) {
      const f = k.startsWith("set.") ? def.fields[k.slice(4)] : undefined;
      if (!f || f.readOnly || !v || ["ref", "text"].includes(String(f.edt.kind))) continue;
      const [val, err] = coerce(f.edt, v, registry);
      if (!err) record[k.slice(4)] = val;
    }
    // poslední použité hodnoty uživatele (název deníku…)
    if (!dup && Object.values(def.fields).some((f) => f.rememberLast)) {
      const titles = { ...((record._titles as Record<string, string>) ?? {}) };
      await inTenant(s.ctx, (sess) => sess.applyLastValues(def, record)).catch(() => undefined);
      record._titles = { ...((record._titles as Record<string, string>) ?? {}), ...titles };
    }
  }
  else {
    const r = await getRecord(s.ctx, def.id, id).catch(() => null);
    // záznam v aktuální firmě není (např. po přepnutí firmy) → přehled
    if (!r) redirect(objectHref(def.id));
    record = r;
  }

  const locked = !isNew && !!def.lockedWhen && record[def.lockedWhen.field] === def.lockedWhen.equals;
  const readOnly = (!!def.systemOnly && !def.userCorrect) || locked || !mayWrite;
  const recordTitle = isNew ? `${t("@SYS:New")} · ${t(def.label)}` : String(record[def.titleField] ?? t(def.label));
  const mod = registry.modules.get(module)!;

  // aktivní finanční dimenze (dialog dimenzí v mřížce řádků)
  const dimDefs =
    !isNew && (def.lines ?? []).some((l) => l.dims)
      ? (await inTenant(s.ctx, (sess) => sess.sys().find("gl.dimension", { active: true }, 6, { position: "asc" })).catch(() => [])).map((d) => ({ slot: Number(d.position), name: String(d.name), id: String(d.id) }))
      : [];
  const lines: LineSpec[] = isNew
    ? []
    : await Promise.all(
        (def.lines ?? [])
          .filter((l) => s.ctx.modules.has(l.object.split(".")[0]))
          .map(async (l) => {
            const ld = registry.objects.get(l.object)!;
            const lm = fieldsMeta(s.ctx, ld, t);
            const initial = await listRecords(s.ctx, ld.id, { filter: { [l.field]: id }, pageSize: l.inline ? 2000 : 100, maxPageSize: l.inline ? 2000 : undefined, lang: s.lang, totals: true });
            return {
              objectId: ld.id,
              field: l.field,
              label: t(l.label),
              titleField: ld.titleField,
              columns: ld.list.filter((f) => f !== l.field && !hiddenFields(s.ctx, ld).includes(f)).map((f) => lm[f]),
              groups: formGroups(s.ctx, ld, t, lm, [l.field]),
              defaults: { ...defaults(ld), ...Object.fromEntries(Object.entries(l.inherit ?? {}).map(([lf, pf]) => [lf, record[pf] ?? null])) },
              carry: l.carry,
              balance: l.balance,
              details: (l.details ?? [])
                .map((d) => {
                  const pick = (fs: string[]) => fs.filter((f) => lm[f] && !hiddenFields(s.ctx, ld).includes(f)).map((f) => lm[f]);
                  const sections = d.sections?.map((x) => ({ label: t(x.label), fields: pick(x.fields) })).filter((x) => x.fields.length);
                  return { label: t(d.label), fields: pick(d.fields), ...(sections ? { sections } : {}) };
                })
                .filter((d) => d.fields.length),
              dims: l.dims && dimDefs.length ? { ...l.dims, defs: dimDefs } : undefined,
              // přehled samostatných dokladů (výpisy účtu, faktury odběratele): jen otevřít
              overview: l.owned === false || !!ld.systemOnly,
              inline: !!l.inline,
              // řádek s akcemi (Osamostatnit…) se otevírá na své stránce
              openInPage: !!ld.actions?.some((a) => !a.bulk),
              // hromadné akce nad vybranými řádky (deník z vybraných řádků výpisu…)
              bulkActions: can(s.ctx.perms, ld.id, "write") ? (ld.actions ?? []).filter((a) => a.bulk && (!a.module || s.ctx.modules.has(a.module))).map((a) => ({ id: a.id, label: t(a.label), icon: a.icon })) : [],
              sortField: ld.defaultSort?.field,
              editable: l.owned !== false && !ld.systemOnly && !locked && can(s.ctx.perms, ld.id, "write"),
              deletable: !!l.deletable && can(s.ctx.perms, ld.id, "delete"),
              initial: { rows: initial.rows, total: initial.total, totals: initial.totals },
            };
          }),
      );

  // související doklady: počet (tlačítko bez záznamů je neaktivní)
  const related = isNew
    ? []
    : await Promise.all(
        (def.related ?? [])
          .filter((r) => s.ctx.modules.has(r.object.split(".")[0]) && can(s.ctx.perms, r.object, "read"))
          .map(async (r) => {
            const value = r.ref ? record[r.ref] : id;
            const title = r.ref ? ((record._titles as Record<string, string> | undefined)?.[r.ref] ?? "").split(" · ")[0] : String(record[def.titleField] ?? "");
            return {
              label: t(r.label),
              href: `${objectHref(r.object)}?filter.${r.field}=${encodeURIComponent(title)}`,
              count: value ? (await listRecords(s.ctx, r.object, { filter: { [r.field]: value }, pageSize: 1 })).total : 0,
            };
          }),
      );

  // proužek workflow (jako v AX): běh nad záznamem, krok, tlačítka řešitele, historie
  const wfData = isNew ? null : await workflowBar(s.ctx, def.id, id, (r) => t(r)).catch(() => null);
  const workflow = wfData
    ? {
        data: wfData,
        labels: Object.fromEntries(
          (["workflow", "step", "assignee", "unassigned", "due", "approve", "reject", "done", "history", "openTask", "cancel", "cancelConfirm", "comment", "confirm", "back", "close", "kind", "status", "created", "completed", "completedBy", "result", "task"] as const).map((k) => [k, t(`@WF:Bar${k.charAt(0).toUpperCase()}${k.slice(1)}`)]),
        ) as unknown as WorkflowBarLabels,
      }
    : null;

  return (
    <ObjectDetailView
      workflow={workflow}
      related={related}
      helpHref={helpFor(def.id) ? `/help/${helpFor(def.id)!.id}` : undefined}
      helpLabel={t("@SYS:HelpOpen")}
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
      showDelete={!isNew && !def.systemOnly && can(s.ctx.perms, def.id, "delete")}
      canDuplicate={!isNew && !def.systemOnly && mayWrite}
      mustChange={dup && "values" in dup && dup.mustChange.length ? { fields: Object.fromEntries(dup.mustChange.map((f) => [f, String(dup.values[f] ?? "")])), text: t("@SYS:ChangeKeyOnCopy") } : undefined}
      compactHeader={!!def.compactHeader}
      collapseHeader={!!def.collapseHeader}
      autoCreate={isNew && !!def.numberSeq && (def.lines ?? []).some((l) => l.owned !== false)}
      newLinesHint={t("@SYS:LinesAfterHeader")}
      printDirect={directPrintObjectIds().has(def.id)}
      printHref={!isNew && s.ctx.modules.has("prt") && printableObjectIds().has(def.id) ? `/print/${def.id}/${id}` : undefined}
      printDialog={{ title: t("@PRT:Print"), print: t("@PRT:Print"), pdf: t("@PRT:Pdf"), email: t("@INT:SendByEmail"), newWindow: t("@PRT:OpenNewWindow"), close: t("@PRT:Close") }}
      actions={
        // tlačítka stojí pořád na stejném místě; mimo svůj stav jsou jen neaktivní
        isNew || !mayWrite
          ? []
          : (def.actions ?? [])
              .filter((a) => (!a.module || s.ctx.modules.has(a.module)) && (!a.adminOnly || s.ctx.perms.admin))
              .map((a) => ({ id: a.id, label: t(a.label), icon: a.icon, upload: a.upload, download: a.download, group: a.group ?? (a.download ? "print" : "process"), confirm: a.confirm ? { value: String(record[a.confirm.field] ?? ""), text: t(a.confirm.text) } : undefined, disabled: !!a.when && record[a.when.field] !== a.when.equals }))
      }
      titleField={def.titleField}
      postingPreview={
        // Náhled dokladu, dokud jde zaúčtovat (pak ukazuje skutečný doklad tlačítko Doklad)
        !isNew && mayWrite && !!def.postingPreview && (def.actions ?? []).some((a) => a.id === def.postingPreview && (!a.when || record[a.when.field] === a.when.equals))
      }
      lines={lines}
      lang={s.lang}
      labels={uiLabels(t)}
    />
  );
}
