/**
 * Registr všech modulů a rozšíření. Nový modul = přidat sem.
 */
import { buildLabelTable } from "@/core/labels";
import { buildRegistry } from "@/core/module";
import gab from "@/modules/gab";
import gl from "@/modules/gl";
import { glHandlers } from "@/modules/gl/posting";
import sys from "@/modules/sys";
import tax from "@/modules/tax";
import subjectRating from "@/extensions/subject-rating";

export const modules = [sys, gab, gl, tax];
export const extensions = [subjectRating];

export const registry = buildRegistry(modules, extensions, [glHandlers]);

/** prefix labelů modulu = id velkými písmeny (gab → @GAB:…) */
export const labelFiles = [
  ...modules.map((m) => ({ prefix: m.id.toUpperCase(), labels: m.labels })),
  ...extensions.map((x) => ({ prefix: x.labelPrefix, labels: x.labels })),
];

export const labelTable = buildLabelTable(labelFiles);
