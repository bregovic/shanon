import { notFound } from "next/navigation";
import { dependents } from "@/core/module";
import { registry } from "@/registry";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { toggleExtensionAction, toggleModuleAction } from "@/app/actions";
import { cn } from "@/lib/cn";

export default async function ModulesPage() {
  const s = await requireSession();
  if (s.user.role !== "admin") notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  const name = (id: string) => t(registry.modules.get(id)!.label);

  const modules = [...registry.modules.values()].map((m) => {
    const enabled = s.ctx.modules.has(m.id);
    const neededBy = dependents(registry, m.id).filter((d) => s.ctx.modules.has(d));
    return { m, enabled, neededBy, canToggle: !m.core && (!enabled || neededBy.length === 0) };
  });
  const extensions = [...registry.extensions.values()].filter(
    (x) => x.visibility === "public" || x.owner === s.ctx.tenantId,
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <h1 className="text-2xl font-semibold">{t("@SYS:Modules")}</h1>
      <div className="card divide-y divide-line">
        {modules.map(({ m, enabled, neededBy, canToggle }) => (
          <div key={m.id} className="flex items-start gap-4 p-5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-medium">
                {t(m.label)}
                {enabled && <span className="rounded-full bg-ok-soft px-2 py-0.5 text-xs text-ok">{t("@SYS:Enabled")}</span>}
              </div>
              <p className="mt-0.5 text-sm text-muted">{t(m.description)}</p>
              {m.dependsOn.length > 0 && (
                <p className="mt-1 text-xs text-muted">
                  {t("@SYS:Requires")}: {m.dependsOn.map(name).join(", ")}
                </p>
              )}
              {enabled && neededBy.length > 0 && (
                <p className="mt-1 text-xs text-muted">
                  {t("@SYS:RequiredBy")}: {neededBy.map(name).join(", ")}
                </p>
              )}
            </div>
            {canToggle && (
              <form action={toggleModuleAction}>
                <input type="hidden" name="module" value={m.id} />
                <input type="hidden" name="enable" value={enabled ? "0" : "1"} />
                <button className={cn("btn", !enabled && "btn-primary")}>{t(enabled ? "@SYS:Disable" : "@SYS:Enable")}</button>
              </form>
            )}
          </div>
        ))}
      </div>

      <h2 className="text-lg font-semibold">{t("@SYS:Extensions")}</h2>
      <div className="card divide-y divide-line">
        {extensions.map((x) => {
          const enabled = s.ctx.extensions.has(x.id);
          const available = x.dependsOn.every((d) => s.ctx.modules.has(d));
          return (
            <div key={x.id} className="flex items-start gap-4 p-5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  {t(x.label)}
                  {enabled && <span className="rounded-full bg-ok-soft px-2 py-0.5 text-xs text-ok">{t("@SYS:Enabled")}</span>}
                </div>
                <p className="mt-0.5 text-sm text-muted">{t(x.description)}</p>
                <p className="mt-1 text-xs text-muted">
                  {t("@SYS:Requires")}: {x.dependsOn.map(name).join(", ")}
                </p>
              </div>
              {(enabled || available) && (
                <form action={toggleExtensionAction}>
                  <input type="hidden" name="extension" value={x.id} />
                  <input type="hidden" name="enable" value={enabled ? "0" : "1"} />
                  <button className={cn("btn", !enabled && "btn-primary")}>{t(enabled ? "@SYS:Disable" : "@SYS:Enable")}</button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
