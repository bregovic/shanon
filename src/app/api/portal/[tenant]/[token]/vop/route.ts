/** Portál smluv – obchodní podmínky jako PDF ke stažení (veřejné, stejný odkaz jako portál). */
import { agreementTermsPdf } from "@/server/agreement-portal";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string; token: string }> }) {
  const { tenant, token } = await params;
  const pdf = await agreementTermsPdf(tenant, token).catch(() => null);
  if (!pdf) return new Response("Nenalezeno", { status: 404 });
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="obchodni-podminky.pdf"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
