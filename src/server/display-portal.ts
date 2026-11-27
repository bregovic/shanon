/** Portál „Zákaznická obrazovka“: údaje stránky a stav nákupu vybrané pokladny (src/server/pos-display.ts). */
import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "./db";
import { getT } from "./i18n";
import { loadPortal, portalDesign, type PortalDesign } from "./supplier-portal";
import { waitDisplay } from "./pos-display";

export interface DisplayPortalInfo {
  design: PortalDesign;
  companyName: string;
  title: string;
  intro: string;
  texts: Record<string, string>;
}

const KEYS = ["DisplayTotal", "DisplayThanks", "DisplayPaid", "DisplayChange", "DisplayScanToPay", "DisplayCustomer", "DisplayNoRegister"];

export async function displayPortalInfo(tenantId: string, token: string, client: PrismaClient = prisma): Promise<DisplayPortalInfo | null> {
  const l = await loadPortal(tenantId, token, client);
  if (!l || l.portal.purpose !== "display") return null;
  const t = await getT("cs", l.ctx.tenantId);
  return {
    design: await portalDesign(l, tenantId, token, client),
    companyName: l.companyName,
    title: String(l.portal.title ?? "") || l.companyName,
    intro: String(l.portal.intro ?? ""),
    texts: Object.fromEntries(KEYS.map((k) => [k, t(`@INT:${k}`)])),
  };
}

/** Dlouhý dotaz obrazovky: stav nákupu pokladny portálu (null = odkaz neplatí, bez pokladny = úvod). */
export async function displayPortalState(tenantId: string, token: string, since: number, client: PrismaClient = prisma) {
  const l = await loadPortal(tenantId, token, client);
  if (!l || l.portal.purpose !== "display") return null;
  if (!l.portal.registerId) return { version: 0, state: null };
  return waitDisplay(l.ctx.tenantId, String(l.portal.registerId), since);
}
