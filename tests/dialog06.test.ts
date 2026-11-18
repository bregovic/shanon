import { describe, expect, it } from "vitest";
import { ACK, ENQ, EOT, ESC, ETX, STX, encodeClear, encodeStatusRequest, encodeUnitPrice, parseDialog06, scaleText, type Dialog06Message } from "../src/lib/dialog06";
import { ScaleDriver, type ScaleState, type ScaleTransport } from "../src/lib/scale-driver";
import { SimScaleTransport } from "../src/lib/scale-sim";

const bytes = (...parts: (number | string)[]) => parts.flatMap((p) => (typeof p === "number" ? [p] : [...p].map((c) => c.charCodeAt(0))));

describe("Dialog 06 — kodek (předběžné rámce)", () => {
  it("cena za kg: EOT STX 01 ESC 6 číslic (haléře) ESC ETX", () => {
    expect(Array.from(encodeUnitPrice(31900))).toEqual(bytes(EOT, STX, "01", ESC, "031900", ESC, ETX));
  });
  it("cena + název: zpráva 04, text bez diakritiky, nejvýš 13 znaků", () => {
    expect(Array.from(encodeUnitPrice(31900, "Pražská šunka na kosti"))).toEqual(bytes(EOT, STX, "04", ESC, "031900", ESC, "Prazska sunka", ESC, ETX));
    expect(scaleText("Žluťoučký kůň")).toBe("Zlutoucky kun");
  });
  it("vymazání ceny a dotaz na stav", () => {
    expect(Array.from(encodeClear())).toEqual(bytes(EOT, STX, "01", ESC, "000000", ESC, ETX));
    expect(Array.from(encodeStatusRequest())).toEqual([EOT, ENQ]);
  });
  it("datová zpráva: hmotnost a ceny jako text přesně z váhy", () => {
    const r = parseDialog06(bytes(STX, "02", ESC, "3", ESC, "00384", ESC, "031900", ESC, "012250", ETX));
    expect(r?.msg).toMatchObject({ kind: "data", weight: "0.384", unitPrice: "319.00", total: "122.50" });
    expect((r?.msg as { raw: string }).raw).toMatch(/^02 30 32 1b/);
  });
  it("stav, ACK, nedokončená zpráva", () => {
    expect(parseDialog06(bytes(STX, "09", ESC, "30", ETX))?.msg).toMatchObject({ kind: "status", status: "overload", code: "30" });
    expect(parseDialog06(bytes(STX, "09", ESC, "99", ETX))?.msg).toMatchObject({ kind: "status", status: "error" });
    expect(parseDialog06([ACK])?.msg).toEqual({ kind: "ack" });
    expect(parseDialog06(bytes(STX, "02", ESC, "3"))).toBeNull();
  });
});

/** počkat, až driver dojde do stavu */
const until = (d: ScaleDriver, ok: (s: ScaleState) => boolean, ms = 8000) =>
  new Promise<ScaleState>((res, rej) => {
    let off = () => {};
    let done = false;
    const t = setTimeout(() => (off(), rej(new Error(`stav ${d.snapshot.phase} / ${d.snapshot.problem}`))), ms);
    off = d.subscribe((s) => {
      if (done || !ok(s)) return;
      done = true;
      clearTimeout(t);
      queueMicrotask(() => off());
      res(s);
    });
  });

const HAM = { id: "i1", name: "Pražská šunka", unitPrice: "319.00" };

describe("ScaleDriver se simulátorem váhy", () => {
  it("cena do váhy → neustáleno → ustáleno; čtení přesně z váhy", async () => {
    const d = new ScaleDriver(new SimScaleTransport());
    expect(await d.connect()).toBe(true);
    await d.setUnitPrice(HAM);
    const s = await until(d, (x) => x.phase === "stable");
    expect(s.reading?.unitPrice).toBe("319.00");
    expect(s.reading?.weight).toMatch(/^\d\.\d{3}$/);
    expect(s.reading?.total).toMatch(/^\d+\.\d{2}$/);
    expect(s.reading?.raw).toMatch(/^02 /);
    await d.dispose();
  }, 15000);

  it("po přidání další vážení až po návratu na nulu", async () => {
    const d = new ScaleDriver(new SimScaleTransport());
    await d.connect();
    await d.setUnitPrice(HAM);
    await until(d, (x) => x.phase === "stable");
    await d.clear(true);
    await d.setUnitPrice(HAM);
    // zboží ještě leží → needZero, pak prázdná váha → waiting, pak nové zboží → stable
    await until(d, (x) => x.phase === "needZero");
    await until(d, (x) => x.phase === "waiting");
    await until(d, (x) => x.phase === "stable");
    await d.dispose();
  }, 20000);

  it("neshoda ceny za kg = chyba, nepřidat", async () => {
    // váha vrátí jinou cenu za kg, než pokladna poslala
    const t: ScaleTransport = {
      open: async () => {},
      close: async () => {},
      exchange: async (req): Promise<Dialog06Message | null> =>
        req[1] === ENQ ? parseDialog06(bytes(STX, "02", ESC, "3", ESC, "00500", ESC, "029900", ESC, "014950", ETX))!.msg : { kind: "ack" },
    };
    const d = new ScaleDriver(t);
    await d.connect();
    await d.setUnitPrice(HAM);
    const s = await until(d, (x) => x.problem === "priceMismatch");
    expect(s.reading).toBeNull();
    await d.dispose();
  });

  it("váha neodpovídá 3× → Chyba", async () => {
    const t: ScaleTransport = { open: async () => {}, close: async () => {}, exchange: async () => null };
    const d = new ScaleDriver(t);
    await d.connect();
    await d.setUnitPrice(HAM);
    expect(d.snapshot).toMatchObject({ phase: "error", problem: "noResponse" });
    await d.dispose();
  });

  it("odpojená váha → Odpojeno", async () => {
    const t: ScaleTransport = { open: async () => Promise.reject(new Error("no port")), close: async () => {}, exchange: async () => null };
    const d = new ScaleDriver(t);
    expect(await d.connect()).toBe(false);
    expect(d.snapshot.phase).toBe("disconnected");
    await d.dispose();
  });
});
