/**
 * Registr všech modulů a rozšíření. Nový modul = přidat sem.
 */
import { buildLabelTable } from "@/core/labels";
import { buildRegistry } from "@/core/module";
import { ADMIN_ONLY } from "@/core/security";
import gab from "@/modules/gab";
import gl from "@/modules/gl";
import { glHandlers } from "@/modules/gl/posting";
import { dimensionHandlers, dimensionJobs } from "@/modules/gl/dimensions";
import { rateJobs, sysHandlers } from "@/modules/sys/currency";
import { batchHandlers } from "@/modules/sys/batch";
import sys, { BatchClass, NumberedObject, SecurityTarget } from "@/modules/sys";
import tax from "@/modules/tax";
import ar, { ar as arLedger } from "@/modules/ar";
import ap, { ap as apLedger } from "@/modules/ap";
import bank from "@/modules/bank";
import inv from "@/modules/inv";
import { invHandlers } from "@/modules/inv/handlers";
import pos from "@/modules/pos";
import { posHandlers } from "@/modules/pos/sale";
import int from "@/modules/int";
import { intHandlers, intJobs } from "@/modules/int/drivers";
import org, { orgHandlers } from "@/modules/org";
import { aresHandlers } from "@/modules/gab/ares";
import qa, { qaHandlers } from "@/modules/qa";
import { bankHandlers } from "@/modules/bank/handlers";
import { vatReturnHandlers } from "@/modules/tax/vat-return";
import subjectRating from "@/extensions/subject-rating";

export const modules = [sys, org, gab, gl, tax, inv, ar, ap, bank, pos, int, qa];
export const extensions = [subjectRating];

// dávkové úlohy modulů (definice vedle logiky, ke které patří)
sys.jobs = rateJobs;
gl.jobs = dimensionJobs;
int.jobs = intJobs;
BatchClass.values = modules.flatMap((m) => (m.jobs ?? []).map((j) => ({ value: j.id, label: j.label })));

// cíle oprávnění = všechny moduly a jejich objekty (modul, pak jeho objekty)
SecurityTarget.values = modules.flatMap((m) => [
  { value: m.id, label: m.label },
  ...m.objects.filter((o) => !o.adminOnly).map((o) => ({ value: o.id, label: o.labelPlural })),
]);

// objekty s automatickým číslováním (pro pole Použití u číselné řady)
NumberedObject.values = modules.flatMap((m) =>
  m.objects.filter((o) => o.numberSeq).map((o) => ({ value: o.id, label: o.labelPlural })),
);

export const registry = buildRegistry(modules, extensions, [sysHandlers, glHandlers, arLedger.handlers, apLedger.handlers, bankHandlers, vatReturnHandlers, invHandlers, posHandlers, intHandlers, orgHandlers, aresHandlers, qaHandlers, dimensionHandlers, batchHandlers]);

for (const o of registry.objects.values()) if (o.adminOnly) ADMIN_ONLY.add(o.id);

/** prefix labelů modulu = id velkými písmeny (gab → @GAB:…) */
export const labelFiles = [
  ...modules.map((m) => ({ prefix: m.id.toUpperCase(), labels: m.labels })),
  ...extensions.map((x) => ({ prefix: x.labelPrefix, labels: x.labels })),
];

export const labelTable = buildLabelTable(labelFiles);
