/**
 * Registr všech modulů a rozšíření. Nový modul = přidat sem.
 */
import { buildLabelTable } from "@/core/labels";
import { buildRegistry } from "@/core/module";
import { ADMIN_ONLY } from "@/core/security";
import gab from "@/modules/gab";
import gl from "@/modules/gl";
import { glHandlers } from "@/modules/gl/posting";
import { journalHandlers } from "@/modules/gl/journal";
import { dimensionHandlers, dimensionJobs } from "@/modules/gl/dimensions";
import { rateJobs, sysHandlers } from "@/modules/sys/currency";
import { batchHandlers } from "@/modules/sys/batch";
import sys, { BatchClass, NumberedObject, SecurityTarget, ShareableObject } from "@/modules/sys";
import tax from "@/modules/tax";
import ar, { ar as arLedger } from "@/modules/ar";
import ap, { ap as apLedger } from "@/modules/ap";
import bank from "@/modules/bank";
import inv from "@/modules/inv";
import { invHandlers } from "@/modules/inv/handlers";
import pos from "@/modules/pos";
import cash from "@/modules/cash";
import prt, { PrintDocType, prtHandlers } from "@/modules/prt";
import { advancePrintable, invoicePrintable, receiptPrintable, vatPaymentPrintable } from "@/modules/prt/printables";
import { isdocHandlers } from "@/modules/prt/isdoc";
import { cashHandlers } from "@/modules/cash/handlers";
import { posHandlers } from "@/modules/pos/sale";
import { basketHandlers } from "@/modules/pos/basket";
import int from "@/modules/int";
import whs from "@/modules/whs";
import { whsHandlers } from "@/modules/whs/stock";
import { intHandlers, intJobs } from "@/modules/int/drivers";
import org, { orgHandlers } from "@/modules/org";
import { aresHandlers } from "@/modules/gab/registry-lookup";
import qa, { qaHandlers } from "@/modules/qa";
import { bankHandlers } from "@/modules/bank/handlers";
import { paymentHandlers } from "@/modules/bank/payments";
import { vatReturnHandlers } from "@/modules/tax/vat-return";
import { vatPaymentHandlers } from "@/modules/tax/vat-payment";
import { journalTaxHandlers } from "@/modules/tax/journal-tax";
import { portalHandlers } from "@/modules/int/portal";
import shop from "@/modules/shop";
import { shopHandlers } from "@/modules/shop/handlers";
import { nonPayerHandlers, taxRefs } from "@/modules/tax/non-payer";
import subjectRating from "@/extensions/subject-rating";

export const modules = [sys, prt, org, gab, gl, tax, inv, ar, ap, bank, cash, pos, whs, int, shop, qa];
export const extensions = [subjectRating];

// dávkové úlohy modulů (definice vedle logiky, ke které patří)
sys.jobs = rateJobs;
gl.jobs = dimensionJobs;
int.jobs = intJobs;
// tisknutelné doklady (definice v Tiskových sestavách, data z modulu dokladu)
ar.printables = [invoicePrintable, advancePrintable];
pos.printables = [receiptPrintable];
tax.printables = [vatPaymentPrintable];
PrintDocType.values = modules.flatMap((m) => (m.printables ?? []).map((p) => ({ value: p.id, label: p.label })));
BatchClass.values = modules.flatMap((m) => (m.jobs ?? []).map((j) => ({ value: j.id, label: j.label })));

// cíle oprávnění = všechny moduly a jejich objekty (modul, pak jeho objekty)
SecurityTarget.values = modules.flatMap((m) => [
  { value: m.id, label: m.label },
  ...m.objects.filter((o) => !o.adminOnly).map((o) => ({ value: o.id, label: o.labelPlural })),
]);

// číselníky sdílitelné ve virtuální společnosti
ShareableObject.values = modules.flatMap((m) => m.objects.filter((o) => o.shareable).map((o) => ({ value: o.id, label: o.labelPlural })));

// objekty s automatickým číslováním (pro pole Použití u číselné řady)
NumberedObject.values = modules.flatMap((m) =>
  m.objects.filter((o) => o.numberSeq).map((o) => ({ value: o.id, label: o.labelPlural })),
);

export const registry = buildRegistry(modules, extensions, [sysHandlers, glHandlers, journalHandlers, journalTaxHandlers, arLedger.handlers, apLedger.handlers, bankHandlers, vatReturnHandlers, vatPaymentHandlers, invHandlers, posHandlers, intHandlers, orgHandlers, aresHandlers, qaHandlers, dimensionHandlers, batchHandlers, basketHandlers, cashHandlers, prtHandlers, whsHandlers, paymentHandlers, isdocHandlers, portalHandlers, shopHandlers, nonPayerHandlers]);

// odkazy na daňové kódy, skupiny DPH a položky DPH (zjednodušení DPH pro neplátce maže jen nepoužité)
for (const o of registry.objects.values())
  for (const [name, f] of Object.entries(o.fields)) {
    if (f.edt.refObject === "tax.taxCode") taxRefs.codes.push([o.id, name]);
    if (f.edt.refObject === "tax.taxGroup") taxRefs.groups.push([o.id, name]);
    if (f.edt.refObject === "tax.itemTaxGroup") taxRefs.items.push([o.id, name]);
  }

for (const o of registry.objects.values()) if (o.adminOnly) ADMIN_ONLY.add(o.id);

/** prefix labelů modulu = id velkými písmeny (gab → @GAB:…) */
export const labelFiles = [
  ...modules.map((m) => ({ prefix: m.id.toUpperCase(), labels: m.labels })),
  ...extensions.map((x) => ({ prefix: x.labelPrefix, labels: x.labels })),
];

export const labelTable = buildLabelTable(labelFiles);
