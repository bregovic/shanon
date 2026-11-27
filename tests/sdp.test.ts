/**
 * Epson Server Direct Print: napojení dostane adresu s klíčem, kasa uloží účtenku do fronty, tiskárna si ji vyzvedne
 * (PrintRequestInfo s ESC/POS v hex) a nahlásí výsledek (SetResponse); neplatný klíč nic nedostane.
 */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, inTenant, listRecords, runAction, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { queueSdpJob, sdpAuth, sdpGetRequest, sdpSetResponse } from "@/server/sdp";

const client = createPrisma();
const run = Date.now().toString(36);

describe("Server Direct Print", () => {
  it("adresa s klíčem, fronta, dotaz tiskárny a výsledek tisku", async () => {
    const P = (await provisionTenant(client, { code: `t-sdp-${run}`, name: "SDP", adminEmail: `sdp-${run}@test.local`, adminPassword: "heslo-12345", modules: ["pos", "int"], company: { code: "S", name: "S" } })).ctx;
    const regId = String((await listRecords(P, "pos.register", {}, client)).rows[0].id);
    const conn = await saveRecord(P, "int.connection", null, { code: "EPSON-SDP", name: "Epson přes Shanon", kind: "printer", driver: "escposSdp", registerId: regId, openDrawer: true }, undefined, client);
    const url = String(conn.sdpUrl);
    expect(url).toMatch(/\/api\/station\/sdp\/sdp\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{20,}$/);
    const token = url.split("/").pop()!;
    expect(conn.sdpHash).not.toContain(token.split(".").pop());
    const sdp = (await sdpAuth(token))!;
    expect(sdp.connectionId).toBe(conn.id);
    expect(await sdpAuth(`${token}x`)).toBeNull();

    // nic ve frontě → prázdná odpověď (a zapíše se, že se tiskárna ozvala)
    expect(await sdpGetRequest(sdp)).toBe("");
    expect((await getRecord(P, "int.connection", String(conn.id), client))!.sdpSeenAt).toBeTruthy();

    // účtenka do fronty → tiskárna ji dostane jednou
    const job = await inTenant(P, async (s) => queueSdpJob(s.sys().api(), (await s.sys().api().get("int.connection", String(conn.id)))!, Buffer.from([0x1b, 0x40, 0x41, 0x0a]).toString("base64"), "U26000001"), client);
    const xml = await sdpGetRequest((await sdpAuth(token))!);
    expect(xml).toContain('<PrintRequestInfo Version="2.00">');
    expect(xml).toContain("<command>1b40410a</command>");
    const key = /<printjobid>([^<]+)<\/printjobid>/.exec(xml)![1];
    expect((await getRecord(P, "int.netPrintJob", String(job.id), client))!.status).toBe("sent");
    expect(await sdpGetRequest(sdp)).toBe("");

    // výsledek od tiskárny
    const resp = `<?xml version="1.0" encoding="utf-8"?><PrintResponseInfo Version="2.00"><ePOSPrint><Parameter><devid>local_printer</devid><printjobid>${key}</printjobid></Parameter><PrintResponse><response success="true" code="" status="251658262" battery="0" xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"/></PrintResponse></ePOSPrint></PrintResponseInfo>`;
    expect(await sdpSetResponse(sdp, resp)).toBe(1);
    expect((await getRecord(P, "int.netPrintJob", String(job.id), client))!.status).toBe("done");

    // neplatná data se do fronty nedostanou; nová adresa zneplatní starou
    await expect(inTenant(P, async (s) => queueSdpJob(s.sys().api(), (await s.sys().api().get("int.connection", String(conn.id)))!, "není base64!", ""), client)).rejects.toMatchObject({ label: "@INT:SdpBadData" });
    await runAction(P, "int.connection", String(conn.id), "sdpReset", client);
    expect(await sdpAuth(token)).toBeNull();
  }, 120_000);
});
