import { notFound } from "next/navigation";
import { NewsView } from "@/components/news-view";
import { requireSession } from "@/server/auth";
import { listRecords } from "@/server/data";
import { renderMarkdown } from "@/server/help";
import { getT } from "@/server/i18n";
import { objectHref } from "@/server/ui";

export const metadata = { title: "Aktuality" };

/** Aktuality: deník vývoje (nasazené funkce, změny, opravy) po dnech, s hledáním a rozkliknutím popisu. */
export default async function NewsPage() {
  const s = await requireSession();
  if (!s.ctx.modules.has("qa")) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  const rows = (await listRecords(s.ctx, "qa.changelog", { pageSize: 1000, maxPageSize: 2000, sort: "releasedAt", dir: "desc", filter: { published: true } })).rows;
  const kinds = { feature: t("@QA:KindFeature"), change: t("@QA:KindChange"), fix: t("@QA:KindFix") };
  const items = rows.map((r) => ({
    id: String(r.id),
    date: String(r.releasedAt ?? "").slice(0, 10),
    kind: String(r.kind),
    area: String(r.area ?? ""),
    title: String(r.title),
    issue: ((r._titles ?? {}) as Record<string, string>).issueId?.split(" · ")[0] ?? "",
    text: String(r.body ?? ""),
    html: r.body ? renderMarkdown(String(r.body)) : "",
  }));
  return (
    <NewsView
      crumbs={[{ label: t("@QA:Module"), href: "/qa" }, { label: t("@QA:News") }]}
      items={items}
      kinds={kinds}
      logHref={objectHref("qa.changelog")}
      labels={{ intro: t("@QA:NewsDesc"), search: t("@QA:NewsSearch"), all: t("@QA:NewsAll"), none: t("@QA:NewsEmpty"), log: t("@QA:Changelog") }}
    />
  );
}
