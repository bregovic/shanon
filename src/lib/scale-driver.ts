/**
 * ScaleDriver: řízení ověřené pokladní váhy (Dialog 06). Pokladna posílá cenu za kg, váha zváží a sama spočítá
 * cenu; driver jen předává, co váha vrátila. UI zná jen stav (`ScaleState`) a metody connect / setUnitPrice /
 * clear / retry — o protokolu nic.
 *
 * Pravidla (zadání „panel Váha“, metrologie WELMEC 2.2 — pokladna nepočítá cenu):
 * - cena vážené položky se v pokladně NIKDY nepočítá; hmotnost a ceny jdou dál jako text přesně z váhy,
 * - ustálené čtení s cenou za kg jinou, než pokladna poslala = chyba, cena se pošle znovu,
 * - po přidání / zrušení se další čtení přijme až po návratu váhy na nulu (ochrana proti dvojímu přidání),
 * - výměna: odpověď do 1 s, 3 pokusy, pak Chyba „Váha neodpovídá“; dotaz na stav každých 250 ms,
 * - odpojená váha: pokus o připojení každých 5 s.
 *
 * Přenos je vyměnitelný (`ScaleTransport`): Web Serial v Chrome (i Android 148+), simulátor pro testovací
 * prostředí, později případně obal usb-serial-for-android se stejným rozhraním.
 */
import { DIALOG06_LINE, encodeClear, encodeStatusQuery, encodeStatusRequest, encodeUnitPrice, hex, parseDialog06, type Dialog06Message, type Dialog06Status } from "./dialog06";

export interface ScaleTransport {
  open(): Promise<void>;
  close(): Promise<void>;
  /** poslat zprávu a počkat na první úplnou odpověď (null = do timeoutu nic) */
  exchange(req: Uint8Array, timeoutMs: number): Promise<Dialog06Message | null>;
}

/** Čtení z váhy — vše jako text přesně z rámce. */
export interface ScaleWeighing {
  weight: string;
  unitPrice: string;
  total: string;
  raw: string;
  /** čas ustálení (ISO) */
  at: string;
}

export type ScalePhase =
  | "disconnected"
  | "ready" // připojeno, nic nevybráno
  | "sending" // posílám cenu
  | "waiting" // čekám na zboží (0,000 / pod minimem)
  | "needZero" // zboží z minulého vážení je ještě na váze
  | "weighing" // neustáleno
  | "stable" // ustáleno — jde přidat
  | "error";

export interface ScaleState {
  phase: ScalePhase;
  /** vybrané zboží a cena za kg, kterou pokladna poslala */
  product: { id: string; name: string; unitPrice: string } | null;
  reading: ScaleWeighing | null;
  /** stav z váhy (pod minimem, přetíženo…) nebo chyba driveru */
  problem: Dialog06Status | "noResponse" | "priceMismatch" | "disconnected" | null;
}

const POLL_MS = 250;
const TIMEOUT_MS = 1000;
const TRIES = 3;
const RECONNECT_MS = 5000;

const cents = (price: string) => {
  const [i, f = ""] = String(price).replace(",", ".").split(".");
  return Number(i) * 100 + Number((f + "00").slice(0, 2));
};
const isZero = (w: string) => !/[1-9]/.test(w);

export class ScaleDriver {
  private state: ScaleState = { phase: "disconnected", product: null, reading: null, problem: "disconnected" };
  private listeners = new Set<(s: ScaleState) => void>();
  private connected = false;
  private polling = 0; // číslo běžící smyčky dotazů (nová smyčka ukončí starou)
  private sawZero = true;
  /** váha bere cenu s názvem zboží (záznam 04); false = jen cena (01) — TEM EGE-M doplňky odmítá NAKem */
  private withText = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private busy: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(private transport: ScaleTransport) {}

  get snapshot(): ScaleState {
    return this.state;
  }

  subscribe(fn: (s: ScaleState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<ScaleState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  /** výměny jdou za sebou (sériová linka nesnese souběh) */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.busy.then(fn, fn);
    this.busy = run.catch(() => undefined);
    return run;
  }

  async connect(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      await this.transport.open();
      this.connected = true;
      this.set({ phase: this.state.product ? "sending" : "ready", problem: null });
      if (this.state.product) await this.setUnitPrice(this.state.product);
      return true;
    } catch {
      this.lost();
      return false;
    }
  }

  /** odpojeno (kabel, vypnutá váha): stav Odpojeno a nový pokus za 5 s; kusové zboží jde prodávat dál */
  private lost() {
    this.connected = false;
    this.polling++;
    this.set({ phase: "disconnected", problem: "disconnected", reading: null });
    void this.transport.close().catch(() => undefined);
    if (!this.disposed) this.reconnectTimer = setTimeout(() => void this.connect(), RECONNECT_MS);
  }

  /** jedna výměna s opakováním; null = váha 3× neodpověděla (nebo NAK) */
  private async ask(req: Uint8Array, wantAck: boolean): Promise<Dialog06Message | null> {
    for (let i = 0; i < TRIES; i++) {
      let m: Dialog06Message | null;
      try {
        m = await this.serial(() => this.transport.exchange(req, TIMEOUT_MS));
      } catch {
        this.lost();
        return null;
      }
      // NAK na dotaz o hmotnost = váha teď hmotnost nedá → důvod ze záznamu 09 (neustálená, pod minimem…)
      if (m?.kind === "nak" && !wantAck) {
        try {
          const st = await this.serial(() => this.transport.exchange(encodeStatusQuery(), TIMEOUT_MS));
          if (st?.kind === "status") return st;
        } catch {
          this.lost();
          return null;
        }
      }
      if (!m || m.kind === "nak") continue;
      if (wantAck && m.kind !== "ack") continue;
      return m;
    }
    return null;
  }

  /** Vybrané vážené zboží: cena za kg (a název) do váhy, pak dotazy na stav. Jiné zboží během vážení = výměna. */
  async setUnitPrice(product: { id: string; name: string; unitPrice: string }): Promise<void> {
    const loop = ++this.polling;
    this.set({ product, reading: null, phase: "sending", problem: null });
    if (!this.connected) return this.set({ phase: "disconnected", problem: "disconnected" });
    // cena s názvem; když ji váha odmítne, jen cena (a příště rovnou bez názvu)
    let ok = this.withText ? await this.ask(encodeUnitPrice(cents(product.unitPrice), product.name), true) : null;
    if (!ok && loop === this.polling && this.connected) {
      ok = await this.ask(encodeUnitPrice(cents(product.unitPrice)), true);
      if (ok) this.withText = false;
    }
    if (loop !== this.polling) return;
    if (!ok) {
      if (this.connected) this.set({ phase: "error", problem: "noResponse" });
      return;
    }
    this.set({ phase: this.sawZero ? "waiting" : "needZero" });
    void this.poll(loop);
  }

  private async poll(loop: number) {
    while (loop === this.polling && this.connected && !this.disposed) {
      const m = await this.ask(encodeStatusRequest(), false);
      if (loop !== this.polling) return;
      if (!m) {
        if (this.connected) this.set({ phase: "error", problem: "noResponse" });
        return;
      }
      this.handle(m);
      // ověřená váha vydá výsledek jednou (pak cenu sama vynuluje) → hotové vážení držet, dál se neptat;
      // nové vážení začne klepnutím na zboží (Přidat / Zrušit)
      if (this.state.phase === "stable") return;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  private handle(m: Dialog06Message) {
    const product = this.state.product;
    if (m.kind === "status") {
      // pod minimem / bez zboží = váha je prázdná → další vážení povoleno
      if (m.status === "belowMin") {
        this.sawZero = true;
        // „pod minimem“ hlásit jen když na váze něco bylo (prázdná váha hlásí totéž)
        return this.set({ phase: "waiting", reading: null, problem: this.state.reading || this.state.phase === "weighing" ? "belowMin" : null });
      }
      if (m.status === "unstable") return this.set({ phase: this.sawZero ? "weighing" : "needZero", problem: null });
      // od posledního vážení se váha nevrátila na nulu → sundat zboží
      if (m.status === "noZero") {
        this.sawZero = false;
        return this.set({ phase: "needZero", reading: null, problem: null });
      }
      return this.set({ phase: "error", reading: null, problem: m.status });
    }
    if (m.kind !== "data") return;
    if (isZero(m.weight)) {
      this.sawZero = true;
      return this.set({ phase: "waiting", reading: null, problem: null });
    }
    // zboží z minulého vážení ještě leží na váze
    if (!this.sawZero) return this.set({ phase: "needZero", reading: null, problem: null });
    // výsledek už je vydaný a váha cenu vynulovala (TEM EGE-M) — hotové vážení platí
    if (this.state.phase === "stable" && this.state.reading && cents(m.unitPrice) === 0) return;
    // cena za kg z váhy musí být ta, kterou pokladna poslala (porovnání textu v haléřích, ne výpočet)
    if (!product || cents(m.unitPrice) !== cents(product.unitPrice)) {
      this.set({ phase: "error", reading: null, problem: "priceMismatch" });
      console.warn(`[váha] neshoda ceny za kg: poslána ${product?.unitPrice}, váha ${m.unitPrice} (${m.raw})`);
      if (product) void this.setUnitPrice(product);
      return;
    }
    this.set({ phase: "stable", problem: null, reading: { weight: m.weight, unitPrice: m.unitPrice, total: m.total, raw: m.raw, at: new Date().toISOString() } });
  }

  /**
   * Přidáno do nákupu / Zrušit: vymazat cenu ve váze a další čtení přijmout až po návratu na nulu.
   * `added` = položka šla do nákupu (zboží ještě leží na váze).
   */
  async clear(added: boolean): Promise<void> {
    this.polling++;
    if (added) this.sawZero = false;
    this.set({ product: null, reading: null, phase: this.connected ? "ready" : "disconnected", problem: this.connected ? null : "disconnected" });
    if (this.connected) await this.ask(encodeClear(), true);
  }

  /** Chyba „Váha neodpovídá“ → zkusit znovu (s aktuálním zbožím). */
  async retry(): Promise<void> {
    if (!this.connected) return void (await this.connect());
    if (this.state.product) await this.setUnitPrice(this.state.product);
    else this.set({ phase: "ready", problem: null });
  }

  async dispose() {
    this.disposed = true;
    this.polling++;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    await this.transport.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Přenos přes Web Serial: port otevřený po celou dobu, čtení na pozadí do bufferu
// ---------------------------------------------------------------------------

interface SerialPortLike {
  open(o: { baudRate: number; dataBits?: number; stopBits?: number; parity?: string }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

export class WebSerialTransport implements ScaleTransport {
  private buf: number[] = [];
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private open_ = false;
  private failed = false;
  private wake: (() => void) | null = null;

  constructor(
    private getPort: () => Promise<SerialPortLike | null>,
    private baudRate = 9600,
    /** linka z napojení váhy (výchozí 8N1) */
    private line: { dataBits: 7 | 8; parity: "none" | "even" | "odd"; stopBits: 1 | 2 } = DIALOG06_LINE,
  ) {}

  async open() {
    const port = await this.getPort();
    if (!port) throw new Error("no port");
    if (!this.open_) {
      await port.open({ baudRate: this.baudRate, ...this.line });
      this.open_ = true;
      this.failed = false;
      this.port = port;
      void this.pump(port);
    }
  }
  private port: SerialPortLike | null = null;

  private async pump(port: SerialPortLike) {
    try {
      this.reader = port.readable!.getReader();
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this.buf.push(...value);
        this.wake?.();
      }
    } catch {
      // vytažený kabel / vypnutá váha: další výměna skončí chybou → driver přejde do Odpojeno
    }
    this.failed = true;
    this.open_ = false;
    this.wake?.();
  }

  async close() {
    await this.reader?.cancel().catch(() => undefined);
    this.reader?.releaseLock();
    this.reader = null;
    if (this.port) await this.port.close().catch(() => undefined);
    this.port = null;
    this.open_ = false;
  }

  async exchange(req: Uint8Array, timeoutMs: number): Promise<Dialog06Message | null> {
    if (!this.open_ || !this.port || this.failed) throw new Error("closed");
    this.buf = [];
    const w = this.port.writable!.getWriter();
    try {
      await w.write(req);
    } finally {
      w.releaseLock();
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const r = parseDialog06(this.buf);
      if (r) {
        this.buf = this.buf.slice(r.used);
        return r.msg;
      }
      if (this.failed) throw new Error("closed");
      await new Promise<void>((res) => {
        this.wake = res;
        setTimeout(res, Math.max(5, deadline - Date.now()));
      });
      this.wake = null;
    }
    return null;
  }
}

export { hex };
