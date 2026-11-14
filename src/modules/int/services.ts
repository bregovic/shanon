/**
 * Datové služby (ARES, kurzy ČNB a ECB) jako napojení v Integraci: lze je
 * vypnout, otestovat a každé volání se zapíše do logu napojení.
 *
 * Moduly volají službu přes `withService` — bez modulu Integrace (nebo bez
 * napojení dané služby) služba běží jako dřív, jen bez logu. Vypnuté
 * napojení volání zastaví srozumitelnou hláškou.
 */
import { UserError, type DataApi, type RecordData } from "@/core/module";

export type ServiceDriver = "ares" | "cnb" | "ecb" | "vies" | "dphreg";

export async function withService<T>(data: DataApi, driver: ServiceDriver, operation: string, fn: () => Promise<T>, describe?: (r: T) => string): Promise<T> {
  let conns: RecordData[] = [];
  try {
    conns = await data.find("int.connection", { kind: "service", driver }, { take: 5 });
  } catch {
    conns = []; // Integrace není zapnutá
  }
  if (!conns.length) return fn();
  const conn = conns.find((c) => c.active);
  if (!conn) throw new UserError("@INT:ServiceDisabled", { service: String(conns[0].name) });
  try {
    const r = await fn();
    await log(data, conn, operation, "ok", describe ? describe(r) : null);
    return r;
  } catch (e) {
    const msg = (e as { label?: string }).label ?? (e instanceof Error ? e.message : String(e));
    await log(data, conn, operation, "error", msg);
    throw e;
  }
}

async function log(data: DataApi, conn: RecordData, operation: string, status: "ok" | "error", message: string | null) {
  try {
    await data.create("int.log", { connectionId: conn.id, operation, status, message: message ? message.slice(0, 250) : null });
  } catch {
    /* log nesmí shodit volání služby */
  }
}
