/** Síťová tiskárna Epson (ePOS-Print): ESC/POS v hex uvnitř SOAP, výsledek z odpovědi tiskárny. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { eposCheck, eposPrint, eposUrl } from "@/lib/epos";

const reply = (success: boolean, code = "") =>
  `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><response success="${success}" code="${code}" status="251658262" xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"/></soapenv:Body></soapenv:Envelope>`;

describe("ePOS-Print", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pošle příkazy v hex na službu tiskárny a vrátí výsledek", async () => {
    const fetch = vi.fn(async () => new Response(reply(true)));
    vi.stubGlobal("fetch", fetch);
    expect(await eposPrint("192.168.1.32", Uint8Array.from([0x1b, 0x70, 0, 25, 250]))).toEqual({ ok: true, code: "" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(eposUrl("192.168.1.32"));
    expect(url).toMatch(/^https:\/\/192\.168\.1\.32\/cgi-bin\/epos\/service\.cgi\?devid=local_printer/);
    expect(String(init.body)).toContain("<command>1b700019fa</command>");
  });

  it("chyba tiskárny (otevřený kryt) a nedostupná tiskárna", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(reply(false, "EPTR_COVER_OPEN"))));
    expect(await eposCheck("192.168.1.32")).toEqual({ ok: false, code: "EPTR_COVER_OPEN" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await eposCheck("192.168.1.32")).toEqual({ ok: false, code: "network" });
  });
});
