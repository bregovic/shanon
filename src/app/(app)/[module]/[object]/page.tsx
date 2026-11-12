import { notFound } from "next/navigation";
import { ObjectListView } from "@/components/object-list-view";
import { coerce } from "@/core/validate";
import { registry } from "@/registry";
import { requireSession } from "@/server/auth";
import { listRecords } from "@/server/data";
import { getT } from "@/server/i18n";
import { fieldsMeta, formGroups, uiLabels } from "@/server/ui";

type Params = { module: string; object: string };

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { module, object } = await params;
  const def = registry.objects.get(`${module}.${object}`);
  return { title: def ? (await getT("cs"))(def.labelPlural) : undefined };
}

export default async function ObjectListPage({ params }: { params: Promise<Params> }) {
  const { module, object } = await params;
  const s = await requireSession();
  const def = registry.objects.get(`${module}.${object}`);
  if (!def || !s.ctx.modules.has(module)) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  if (def.scope === "company" && !s.ctx.companyId) {
    return <p style={{ padding: 24 }}>{t("@SYS:NoCompany")}</p>;
  }
  const meta = fieldsMeta(s.ctx, def, t);
  const mod = registry.modules.get(module)!;
  const initial = await listRecords(s.ctx, def.id, { lang: s.lang });

  const defaults: Record<string, unknown> = {};
  for (const [n, f] of Object.entries(def.fields)) {
    if (f.default !== undefined) defaults[n] = coerce(f.edt, f.default, registry)[0];
  }
  const openInPage = !!def.lines?.length || !!def.actions?.length;

  return (
    <ObjectListView
      objectId={def.id}
      crumbs={[{ label: t(mod.label), href: `/${module}` }, { label: t(def.labelPlural) }]}
      label={t(def.label)}
      titleField={def.titleField}
      columns={def.list.map((f) => meta[f])}
      groups={formGroups(s.ctx, def, t, meta)}
      defaults={defaults}
      canCreate={!def.systemOnly}
      canDelete={!def.systemOnly}
      openInPage={openInPage || !!def.systemOnly}
      initial={{ rows: initial.rows, total: initial.total }}
      lang={s.lang}
      labels={uiLabels(t)}
    />
  );
}
