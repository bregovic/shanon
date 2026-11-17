/**
 * Dodavatelský portál — nastavení (odkaz s tajným klíčem) a kontrola souborů.
 * Příjem z veřejné stránky dělá `src/server/supplier-portal.ts`.
 */
import { randomBytes } from "node:crypto";
import { UserError, type DataApi, type ObjectHandlers, type RecordData } from "@/core/module";
import { SHOP_PATHS } from "@/lib/reserved-paths";

/** Nový tajný klíč odkazu (24 bajtů, base64url). */
export const newPortalToken = () => randomBytes(24).toString("base64url");
export const portalPath = (tenantId: string, token: string) => `/portal/${tenantId}/${token}`;

/** Horní meze limitů (nastavení je nesmí překročit — platformní limit souboru je 10 MB). */
export const PORTAL_CAPS = { maxFileMb: 10, maxFiles: 10, ipHourLimit: 100, dailyLimit: 2000 };

export type PortalFileKind = "pdf" | "image" | "isdoc" | "isdocx" | "xml";

/**
 * Druh souboru podle obsahu (ne jen přípony): PDF, PNG / JPEG / WEBP, ISDOCX (ZIP), XML / ISDOC.
 * Nesoulad obsahu a přípony = odmítnout.
 */
export function sniffPortalFile(name: string, data: Buffer): PortalFileKind | null {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
  const head = data.subarray(0, 16);
  const starts = (sig: number[]) => sig.every((b, i) => head[i] === b);
  const isPdf = head.subarray(0, 5).toString("latin1") === "%PDF-";
  const isPng = starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const isJpg = starts([0xff, 0xd8, 0xff]);
  const isWebp = head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP";
  const isZip = starts([0x50, 0x4b, 0x03, 0x04]);
  const text = data.subarray(0, 200).toString("utf8").replace(/^﻿/, "").trimStart();
  const isXml = text.startsWith("<");
  if (ext === "pdf" && isPdf) return "pdf";
  if (["png", "jpg", "jpeg", "webp"].includes(ext) && (isPng || isJpg || isWebp)) return "image";
  if (ext === "isdocx" && isZip) return "isdocx";
  if (ext === "isdoc" && isXml) return "isdoc";
  if (ext === "xml" && isXml) return "xml";
  return null;
}

/** Jednoduchá adresa portálu: /<zkratka organizace>/<adresa portálu> (bez zkratky null). */
async function simplePath(data: DataApi, slug: unknown): Promise<string | null> {
  if (!slug) return null;
  const [ent] = await data.find("org.entity", {}, { take: 1 }).catch(() => [] as RecordData[]);
  return ent?.publicSlug ? `${ent.publicSlug}/${slug}` : null;
}

export const portalHandlers: Record<string, ObjectHandlers> = {
  "int.portal": {
    async beforeSave(ctx, d) {
      if (!d.token) d.token = newPortalToken();
      if (d.slug) d.slug = String(d.slug).trim().toLowerCase();
      // adresy e-shopu (/<zkratka>/kosik…) portál obsadit nesmí
      if (d.slug && SHOP_PATHS.has(String(d.slug))) return { slug: "@INT:SlugTaken" };
      const simple = await simplePath(ctx.data, d.slug);
      d.publicUrl = simple ? `/${simple}` : portalPath(ctx.tenantId, String(d.token));
      // limity v mezích platformy
      const cap = (f: keyof typeof PORTAL_CAPS, min: number) => {
        const v = Number(d[f] ?? 0);
        d[f] = Math.max(min, Math.min(PORTAL_CAPS[f], Number.isFinite(v) && v > 0 ? Math.floor(v) : min));
      };
      cap("maxFileMb", 1);
      cap("maxFiles", 1);
      cap("ipHourLimit", 1);
      cap("dailyLimit", 1);
    },
    /** jednoduchá adresa je jedinečná v celé aplikaci */
    async afterSave(ctx, d) {
      const simple = await simplePath(ctx.data, d.slug);
      if (ctx.data.claimGlobalKey && !(await ctx.data.claimGlobalKey("portal", simple, String(d.id))))
        throw new UserError("@INT:SlugTaken", { url: `/${simple}` }, { slug: "@INT:SlugTaken" });
    },
    async afterDelete(ctx, d) {
      await ctx.data.claimGlobalKey?.("portal", null, String(d.id));
    },
    actions: {
      /** nový odkaz: starý přestane platit (třeba když se dostal, kam neměl) */
      async newToken(ctx, p) {
        const token = newPortalToken();
        await ctx.data.update("int.portal", String(p.id), { token });
      },
    },
  },
};
