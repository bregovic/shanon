/** Odkaz z e-mailu dodavatele: přihlásí a otevře Portál (neplatný / použitý odkaz → přihlášení s hláškou). */
import { NextResponse } from "next/server";
import { consumeVendorLink } from "@/server/portal-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const ok = await consumeVendorLink(tenant, token).catch(() => false);
  return NextResponse.redirect(new URL(`/p/${encodeURIComponent(tenant)}${ok ? "" : "?link=invalid"}`, req.url), 303);
}
