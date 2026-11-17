/**
 * E-shop — odeslání objednávky (veřejné). Kontroly, ceny a limit z adresy: src/modules/shop/catalog.ts.
 * Tady jen velikost těla a past na roboty.
 */
import { shopOrder } from "@/server/eshop";

export const dynamic = "force-dynamic";

const str = (v: unknown, n = 255) => String(v ?? "").slice(0, n);

export async function POST(req: Request, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  if (Number(req.headers.get("content-length") ?? 0) > 64 * 1024) return Response.json({ ok: false, error: "Příliš velká objednávka." }, { status: 413 });
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }
  // past na roboty: skryté pole vyplní jen automat — nic se neuloží
  if (str(b.website)) return Response.json({ ok: false, error: "Objednávku se nepodařilo odeslat." }, { status: 400 });
  const buyer = (b.buyer ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(b.lines) ? b.lines.slice(0, 100).map((l) => ({ itemId: str((l as { itemId?: unknown }).itemId, 40), qty: str((l as { qty?: unknown }).qty, 12) })) : [];
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const res = await shopOrder(
    org,
    {
      lines,
      deliveryId: b.deliveryId ? str(b.deliveryId, 40) : null,
      paymentMethodId: b.paymentMethodId ? str(b.paymentMethodId, 40) : null,
      terms: b.terms === true,
      buyer: {
        name: str(buyer.name, 120),
        email: str(buyer.email, 254),
        phone: str(buyer.phone, 30),
        companyName: str(buyer.companyName, 120),
        regNo: str(buyer.regNo, 20),
        vatId: str(buyer.vatId, 20),
        street: str(buyer.street),
        city: str(buyer.city),
        zip: str(buyer.zip, 10),
        country: str(buyer.country, 2),
        note: str(buyer.note, 2000),
      },
    },
    ip,
    `${proto}://${host}`,
  );
  if (!res) return Response.json({ ok: false, error: "Obchod nenalezen." }, { status: 404 });
  if (!res.ok) return Response.json({ ok: false, errors: res.errorText }, { status: 400 });
  return Response.json({ ok: true, orderNum: res.orderNum, url: `/${org}/objednavka/${res.token}` });
}
