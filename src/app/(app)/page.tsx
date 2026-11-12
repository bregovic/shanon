import Link from "next/link";
import { registry } from "@/registry";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { objectHref } from "@/server/ui";

export default async function Home() {
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  const mods = [...registry.modules.values()].filter((m) => s.ctx.modules.has(m.id));
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-6 text-2xl font-semibold">{t("@SYS:Home")}</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {mods.map((m) => (
          <div key={m.id} className="card p-5">
            <div className="font-semibold">{t(m.label)}</div>
            <p className="mt-1 text-sm text-muted">{t(m.description)}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {m.menu
                .flatMap((g) => g.items)
                .filter((i) => i.object)
                .map((i) => (
                  <Link key={i.object} href={objectHref(i.object!)} className="rounded-md bg-surface-2 px-2 py-1 text-xs hover:bg-accent-soft hover:text-accent">
                    {t(registry.objects.get(i.object!)!.labelPlural)}
                  </Link>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
