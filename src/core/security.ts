/**
 * Oprávnění (obdoba security rolí v AX/D365, zjednodušeně).
 *
 * Role nese řádky "cíl → úroveň". Cíl je modul ("gl") nebo objekt
 * ("gl.journal"); oprávnění na objekt má přednost před oprávněním na modul.
 * Uživatel má sjednocení svých rolí (vyšší úroveň vyhrává). Správce má vše.
 *
 * Kontroluje se v datové službě (src/server/data.ts) — UI jen skrývá tlačítka.
 */
import { moduleOf } from "./object";

export type Level = "none" | "read" | "write" | "delete";

const RANK: Record<Level, number> = { none: 0, read: 1, write: 2, delete: 3 };

export interface Perms {
  admin: boolean;
  /** cíl → nejvyšší úroveň ze všech rolí uživatele */
  levels: Record<string, Level>;
}

export const ADMIN: Perms = { admin: true, levels: {} };

/** Sjednocení řádků oprávnění z více rolí. */
export function mergePerms(rows: { target: string; level: string }[]): Record<string, Level> {
  const out: Record<string, Level> = {};
  for (const r of rows) {
    const l = (r.level in RANK ? r.level : "none") as Level;
    if (RANK[l] > RANK[out[r.target] ?? "none"]) out[r.target] = l;
  }
  return out;
}

/** objekty jen pro správce (ObjectDef.adminOnly) — plní registr */
export const ADMIN_ONLY = new Set<string>();

export function levelFor(perms: Perms, objectId: string): Level {
  if (perms.admin) return "delete";
  if (ADMIN_ONLY.has(objectId)) return "none";
  return perms.levels[objectId] ?? perms.levels[moduleOf(objectId)] ?? "none";
}

export function can(perms: Perms, objectId: string, need: Exclude<Level, "none">): boolean {
  return RANK[levelFor(perms, objectId)] >= RANK[need];
}

/** Vidí uživatel v modulu aspoň něco? */
export function canSeeModule(perms: Perms, moduleId: string, objectIds: string[]): boolean {
  if (perms.admin) return true;
  if (RANK[perms.levels[moduleId] ?? "none"] >= RANK.read) return true;
  return objectIds.some((o) => can(perms, o, "read"));
}
