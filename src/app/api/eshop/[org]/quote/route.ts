/** E-shop — přepočet košíku (veřejné). Ceny, dostupnost a součty počítá server. */
import { shopQuote } from "@/server/eshop";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  if (Number(req.headers.get("content-length") ?? 0) > 64 * 1024) return Response.json({ error: "Příliš velký košík." }, { status: 413 });
  let body: { lines?: unknown; deliveryId?: unknown; paymentMethodId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Neplatný požadavek." }, { status: 400 });
  }
  const lines = Array.isArray(body.lines) ? body.lines.slice(0, 100).map((l) => ({ itemId: String((l as { itemId?: unknown }).itemId ?? ""), qty: String((l as { qty?: unknown }).qty ?? "1") })) : [];
  const q = await shopQuote(org, { lines, deliveryId: body.deliveryId ? String(body.deliveryId) : null, paymentMethodId: body.paymentMethodId ? String(body.paymentMethodId) : null });
  if (!q) return Response.json({ error: "Obchod nenalezen." }, { status: 404 });
  return Response.json(q);
}
