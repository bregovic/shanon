import { helpFor } from "@/server/help";
import { notFound } from "next/navigation";
import { ObjectListView } from "@/components/object-list-view";
import { coerce } from "@/core/validate";
import { registry } from "@/registry";
import { requireSession } from "@/server/auth";
import { getRecord, listRecords } from "@/server/data";
import { getT } from "@/server/i18n";
import { fieldsMeta, formGroups, hiddenFields, uiLabels } from "@/server/ui";
import { can } from "@/core/security";
import { directPrintObjectIds, printableObjectIds } from "@/server/print";

type Params = { module: string; object: string };

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { module, object } = await params;
  const def = registry.objects.get(`${module}.${object}`);
  return { title: def ? (await getT("cs"))(def.labelPlural) : undefined };
}

export default async function ObjectListPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { module, object } = await params;
  const sp = await searchParams;
  const focus = sp.focus;
  // ?filter.<pole>=<výraz> → filtr sloupce (např. číselné řady modulu: filter.usedFor=qa.*)
  const initialFilters = Object.fromEntries(
    Object.entries(sp)
      .filter(([k, v]) => k.startsWith("filter.") && typeof v === "string")
      .map(([k, v]) => [k.slice(7), String(v)]),
  );
  const s = await requireSession();
  const def = registry.objects.get(`${module}.${object}`);
  if (!def || !s.ctx.modules.has(module)) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  if (!can(s.ctx.perms, def.id, "read")) {
    return <p style={{ padding: 24 }}>{t("@SYS:NoAccess")}</p>;
  }
  if (def.scope === "company" && !s.ctx.companyId) {
    return <p style={{ padding: 24 }}>{t("@SYS:NoCompany")}</p>;
  }
  const meta = fieldsMeta(s.ctx, def, t);
  const mod = registry.modules.get(module)!;
  // filtr z odkazu (?filter.pole=) už v první stránce — jinak by seznam probliknul celý a filtroval se až v prohlížeči
  // uložený pohled: řazení z adresy (?sort=pole&dir=desc), jen existující sloupec
  const sort = sp.sort && sp.sort in def.fields ? sp.sort : undefined;
  const dir = sp.dir === "desc" ? ("desc" as const) : ("asc" as const);
  const initial = await listRecords(s.ctx, def.id, { lang: s.lang, totals: true, filters: Object.keys(initialFilters).length ? initialFilters : undefined, ...(sort ? { sort, dir } : {}) });
  // proklik z odkazu: vybraný záznam musí být v seznamu, i když není na první stránce
  if (focus && !initial.rows.some((r) => r.id === focus)) {
    const rec = await getRecord(s.ctx, def.id, focus).catch(() => null);
    if (rec) initial.rows.unshift(rec);
  }

  const defaults: Record<string, unknown> = {};
  for (const [n, f] of Object.entries(def.fields)) {
    if (f.default !== undefined) defaults[n] = coerce(f.edt, f.default === "$today" ? new Date().toISOString().slice(0, 10) : f.default, registry)[0];
  }
  const openInPage = !!def.lines?.length || !!def.actions?.some((a) => !a.bulk);

  return (
    <ObjectListView
      objectId={def.id}
      crumbs={[{ label: t(mod.label), href: `/${module}` }, { label: t(def.labelPlural) }]}
      label={t(def.label)}
      titleField={def.titleField}
      columns={def.list.filter((f) => !hiddenFields(s.ctx, def).includes(f)).map((f) => meta[f])}
      groups={formGroups(s.ctx, def, t, meta)}
      defaults={defaults}
      canCreate={!def.systemOnly && can(s.ctx.perms, def.id, "write")}
      canWrite={can(s.ctx.perms, def.id, "write")}
      canDelete={!def.systemOnly && can(s.ctx.perms, def.id, "delete")}
      openInPage={openInPage || !!def.systemOnly}
      initial={{ rows: initial.rows, total: initial.total, totals: initial.totals }}
      focusId={focus}
      initialFilters={initialFilters}
      initialSort={sort ? { sort, dir } : undefined}
      viewName={sp.v ? String(sp.v).slice(0, 120) : undefined}
      mergeable={!!def.mergeable}
      helpHref={helpFor(def.id) ? `/help/${helpFor(def.id)!.id}` : undefined}
      helpLabel={t("@SYS:HelpOpen")}
      bulkActions={
        can(s.ctx.perms, def.id, "write")
          ? (def.actions ?? []).filter((a) => a.bulk && !a.download && (!a.module || s.ctx.modules.has(a.module))).map((a) => ({ id: a.id, label: t(a.label), icon: a.icon, input: a.input ? { name: a.input.name, label: t(a.input.label), kind: a.input.kind } : undefined }))
          : []
      }
      // hromadné stažení souborů vybraných záznamů v ZIP (ISDOC faktur…) – stačí právo číst
      bulkDownloads={(def.actions ?? []).filter((a) => a.bulk && a.download && (!a.module || s.ctx.modules.has(a.module))).map((a) => ({ id: a.id, label: t(a.label) }))}
      printDirect={directPrintObjectIds().has(def.id)}
      printHref={s.ctx.modules.has("prt") && printableObjectIds().has(def.id) ? `/print/${def.id}/batch` : undefined}
      printLabel={t("@PRT:Print")}
      printDialog={{ title: t("@PRT:Print"), print: t("@PRT:Print"), pdf: t("@PRT:Pdf"), email: t("@INT:SendByEmail"), newWindow: t("@PRT:OpenNewWindow"), close: t("@PRT:Close") }}
      emailAction={can(s.ctx.perms, def.id, "write") && (def.actions ?? []).some((a) => a.id === "email" && (!a.module || s.ctx.modules.has(a.module)))}
      bulkDoneLabel={t("@SYS:BulkDone")}
      lang={s.lang}
      labels={uiLabels(t)}
    />
  );
}
