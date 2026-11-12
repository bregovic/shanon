import "server-only";
import { cache } from "react";
import { fillLabel, resolveLabel, type Lang, type LabelTable } from "@/core/labels";
import { labelTable } from "@/registry";
import { prisma } from "./db";

export type T = (ref: string | undefined, params?: Record<string, string>) => string;

const overrides = cache(async (tenantId: string): Promise<LabelTable> => {
  const rows = await prisma.sysLabelOverride.findMany({ where: { tenantId } });
  return new Map(rows.map((r) => [`${r.lang}|${r.labelId}`, r.text]));
});

/** Překladová funkce pro jazyk uživatele, s přepisy tenanta. */
export async function getT(lang: Lang, tenantId?: string): Promise<T> {
  const ov = tenantId ? await overrides(tenantId) : undefined;
  return (ref, params) => fillLabel(resolveLabel(labelTable, ref, lang, ov), params);
}
