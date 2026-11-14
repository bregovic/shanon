/**
 * Zvoneček: upozornění firmy, opakování podle klíče, přečtení po uživatelích,
 * chyba dávkové úlohy a nově nespolehlivý plátce DPH.
 */
import { describe, expect, it, vi } from "vitest";
import { createPrisma } from "@/server/db";
import { inTenant, listRecords, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { listNotices, markNoticesRead } from "@/server/notices";
import { recordRun } from "@/server/batch";
import { notify } from "@/modules/sys/notify";
import { checkAllSubjectsVat } from "@/modules/gab/vat-registry";

const client = createPrisma();
const run = Date.now().toString(36);

describe("upozornění", () => {
  it("založení, klíč, přečtení po uživatelích, dávka, nespolehlivý plátce", async () => {
    const T = (await provisionTenant(client, { code: `t-ntc-${run}`, name: "NTC", adminEmail: `ntc-${run}@test.local`, adminPassword: "heslo-12345", modules: ["gab", "int", "ar", "ap"], company: { code: "N", name: "Firma N" } })).ctx;
    const other = await client.sysUser.create({ data: { tenantId: T.tenantId, email: `ntc2-${run}@test.local`, name: "Druhý", passwordHash: "x", role: "user" } });
    await client.sysUserCompany.create({ data: { tenantId: T.tenantId, userId: other.id, companyId: T.companyId! } });
    const U = { ...T, userId: other.id };

    const api = (fn: (d: ReturnType<ReturnType<Parameters<Parameters<typeof inTenant>[1]>[0]["sys"]>["api"]>) => Promise<unknown>) => inTenant(T, (s) => fn(s.sys().api()), client);
    await api((d) => notify(d, { kind: "warning", title: "@SYS:NotifyBatchFailed", params: { job: "Kurzy" }, message: "timeout", href: "/sys/batchJob", key: "k1" }));
    await api((d) => notify(d, { kind: "warning", title: "@SYS:NotifyBatchFailed", params: { job: "Kurzy" }, key: "k1" })); // do 24 h znovu ne
    let a = await listNotices(T, "cs");
    expect(a.unread).toBe(1);
    expect([a.items[0].text, a.items[0].message, a.items[0].href]).toEqual(["Dávková úloha Kurzy skončila chybou", "timeout", "/sys/batchJob"]);
    expect((await listNotices(T, "en")).items[0].text).toBe("Batch job Kurzy failed");

    // přečtení jen pro toho, kdo četl
    await markNoticesRead(T, [a.items[0].id]);
    await markNoticesRead(T, [a.items[0].id]); // podruhé nic
    a = await listNotices(T, "cs");
    expect([a.unread, a.items[0].read]).toEqual([0, true]);
    expect((await listNotices(U, "cs")).unread).toBe(1);

    // chyba dávky → upozornění s odkazem na úlohu
    const [job] = (await listRecords(T, "sys.batchJob", {}, client)).rows;
    await inTenant(T, (s) => recordRun(s.sys().eventCtx("sys.batchJob"), job, Date.now(), "error", "Služba neodpovídá"), client);
    a = await listNotices(T, "cs");
    expect(a.items[0]).toMatchObject({ kind: "error", message: "Služba neodpovídá", href: `/sys/batchJob?focus=${job.id}`, read: false });

    // registr DPH: nově nespolehlivý plátce jednou, opakovaná kontrola už ne
    const subj = await saveRecord(T, "gab.subject", null, { name: "Riziková s.r.o.", vatId: "CZ12345678" }, undefined, client);
    const xml = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><StatusNespolehlivyPlatceRozsirenyResponse><status statusCode="0"/><statusPlatceDPH dic="12345678" nespolehlivyPlatce="ANO" cisloFu="451"/></StatusNespolehlivyPlatceRozsirenyResponse></soapenv:Body></soapenv:Envelope>`;
    vi.stubGlobal("fetch", async () => new Response(xml, { status: 200 }));
    await api((d) => checkAllSubjectsVat(d));
    await api((d) => checkAllSubjectsVat(d));
    vi.unstubAllGlobals();
    const vat = (await listNotices(T, "cs")).items.filter((i) => i.href === `/gab/subject?focus=${subj.id}`);
    expect(vat.map((i) => [i.kind, i.text])).toEqual([["warning", "Riziková s.r.o. (CZ12345678) je nově nespolehlivý plátce DPH"]]);
  }, 120_000);
});
