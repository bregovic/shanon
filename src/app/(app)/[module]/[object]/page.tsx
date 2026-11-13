import { notFound } from "next/navigation";
import { ObjectListView } from "@/components/object-list-view";
import { coerce } from "@/core/validate";
import { registry } from "@/registry";
import { requireSession } from "@/server/auth";
import { getRecord, listRecords } from "@/server/data";
import { getT } from "@/server/i18n";
import { fieldsMeta, formGroups, hiddenFields, uiLabels } from "@/server/ui";
import { can } from "@/core/security";

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
  const initial = await listRecords(s.ctx, def.id, { lang: s.lang, totals: true });
  // proklik z odkazu: vybraný záznam musí být v seznamu, i když není na první stránce
  if (focus && !initial.rows.some((r) => r.id === focus)) {
    const rec = await getRecord(s.ctx, def.id, focus).catch(() => null);
    if (rec) initial.rows.unshift(rec);
  }

  const defaults: Record<string, unknown> = {};
  for (const [n, f] of Object.entries(def.fields)) {
    if (f.default !== undefined) defaults[n] = coerce(f.edt, f.default === "$today" ? new Date().toISOString().slice(0, 10) : f.default, registry)[0];
  }
  const openInPage = !!def.lines?.length || !!def.actions?.length;

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
      lang={s.lang}
      labels={uiLabels(t)}
    />
  );
}
