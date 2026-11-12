/**
 * Registr všech modulů a rozšíření. Nový modul = přidat sem.
 */
import { buildLabelTable } from "@/core/labels";
import { buildRegistry } from "@/core/module";
import { ADMIN_ONLY } from "@/core/security";
import gab from "@/modules/gab";
import gl from "@/modules/gl";
import { glHandlers } from "@/modules/gl/posting";
import sys, { SecurityTarget } from "@/modules/sys";
import tax from "@/modules/tax";
import subjectRating from "@/extensions/subject-rating";

export const modules = [sys, gab, gl, tax];
export const extensions = [subjectRating];

// cíle oprávnění = všechny moduly a jejich objekty (modul, pak jeho objekty)
SecurityTarget.values = modules.flatMap((m) => [
  { value: m.id, label: m.label },
  ...m.objects.filter((o) => !o.adminOnly).map((o) => ({ value: o.id, label: o.labelPlural })),
]);

export const registry = buildRegistry(modules, extensions, [glHandlers]);

for (const o of registry.objects.values()) if (o.adminOnly) ADMIN_ONLY.add(o.id);

/** prefix labelů modulu = id velkými písmeny (gab → @GAB:…) */
export const labelFiles = [
  ...modules.map((m) => ({ prefix: m.id.toUpperCase(), labels: m.labels })),
  ...extensions.map((x) => ({ prefix: x.labelPrefix, labels: x.labels })),
];

export const labelTable = buildLabelTable(labelFiles);
