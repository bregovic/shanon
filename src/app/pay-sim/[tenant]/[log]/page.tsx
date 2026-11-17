/**
 * Simulátor platební brány — testovací platební stránka (veřejná, bez přihlášení). Nic se nestrhává:
 * tlačítko zvolí výsledek platby jako na stránce skutečné brány. Logika: src/server/gateway-sim.ts.
 */
import { notFound } from "next/navigation";
import { simPayment } from "@/server/gateway-sim";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Testovací platba" }, robots: { index: false, follow: false } };

const box: React.CSSProperties = { maxWidth: 420, margin: "48px auto", padding: "28px 24px", borderRadius: 16, background: "#fff", boxShadow: "0 8px 32px rgba(0,0,0,.12)", fontFamily: "system-ui, sans-serif", color: "#1d2327" };
const btn = (bg: string, fg: string): React.CSSProperties => ({ width: "100%", padding: "14px", border: 0, borderRadius: 10, background: bg, color: fg, fontSize: 17, fontWeight: 600, cursor: "pointer", marginTop: 10 });

export default async function SimPage({ params }: { params: Promise<{ tenant: string; log: string }> }) {
  const { tenant, log } = await params;
  const p = await simPayment(tenant, log);
  if (!p) notFound();
  const amount = Number(p.amount).toLocaleString("cs-CZ", { style: "currency", currency: "CZK" });
  const paid = p.state === "PAID" || p.state === "ok";
  return (
    <div style={{ minHeight: "100vh", background: "#eef1f4", padding: "1px 16px" }}>
      <div style={box}>
        <div style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, background: "#fff4ce", color: "#835b00", fontSize: 13, fontWeight: 600 }}>Testovací platba — nic se nestrhává</div>
        <h1 style={{ fontSize: 22, margin: "14px 0 4px" }}>{p.company}</h1>
        <p style={{ margin: 0, color: "#5f6b73" }}>Platba {p.reference}</p>
        <p style={{ fontSize: 34, fontWeight: 700, margin: "18px 0" }}>{amount}</p>
        {p.state === "pending" ? (
          <form method="post" action={`/api/pay-sim/${tenant}/${log}`}>
            <button name="result" value="paid" style={btn("#107c10", "#fff")}>
              Zaplatit (karta, Google Pay)
            </button>
            <button name="result" value="cancelled" style={btn("#f3f2f1", "#1d2327")}>
              Zrušit platbu
            </button>
          </form>
        ) : (
          <p style={{ fontSize: 18, fontWeight: 600, color: paid ? "#107c10" : "#a4262c" }}>{paid ? "✓ Zaplaceno" : "Platba zrušena"}</p>
        )}
        {p.state !== "pending" && p.returnUrl && (
          <a href={p.returnUrl} style={{ color: "#0f6cbd" }}>
            Zpět do obchodu
          </a>
        )}
      </div>
    </div>
  );
}
