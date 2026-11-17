/** Oznámení brány Comgate o stavu platby (veřejné). Stav se vždy ověří u brány: src/server/payment-push.ts. */
import { comgatePush } from "@/server/payment-push";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ tenant: string; conn: string }> }) {
  const { tenant, conn } = await params;
  if (Number(req.headers.get("content-length") ?? 0) > 32 * 1024) return new Response("Too large", { status: 413 });
  const text = await req.text();
  // v2 posílá JSON, v1 formulář
  let transId = "";
  try {
    transId = String((JSON.parse(text) as { transId?: unknown }).transId ?? "");
  } catch {
    transId = new URLSearchParams(text).get("transId") ?? "";
  }
  await comgatePush(tenant, conn, transId);
  return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
}
