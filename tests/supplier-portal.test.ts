/**
 * Dodavatelský portál: odkaz s klíčem, přijetí PDF jako dokladu ke zpracování (zdroj portál, odesílatel,
 * příloha), odmítnutí podle obsahu souboru a údajů, limit z adresy za hodinu, protokol, nový odkaz.
 */
import { describe, expect, it } from "vitest";
import { createPrisma } from "@/server/db";
import { getRecord, listRecords, runAction, saveRecord } from "@/server/data";
import { provisionTenant } from "@/server/provision";
import { portalInfo, portalSubmit } from "@/server/supplier-portal";
import { sniffPortalFile } from "@/modules/int/portal";
import { listDocuRefs } from "@/server/docuref";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { registry } from "@/registry";
import { RESERVED_PATHS } from "@/lib/reserved-paths";

const client = createPrisma();
const run = Date.now().toString(36);
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");

describe("dodavatelský portál", () => {
  it("rozpozná druh souboru podle obsahu", () => {
    expect(sniffPortalFile("faktura.pdf", pdf)).toBe("pdf");
    expect(sniffPortalFile("faktura.pdf", Buffer.from("MZ\x90\x00 tohle je exe"))).toBeNull();
    expect(sniffPortalFile("virus.exe", pdf)).toBeNull();
    expect(sniffPortalFile("f.isdoc", Buffer.from('<?xml version="1.0"?><Invoice/>'))).toBe("isdoc");
    expect(sniffPortalFile("f.isdocx", Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toBe("isdocx");
    expect(sniffPortalFile("sken.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image");
  });

  it("přijetí, kontroly, limity, protokol a nový odkaz", async () => {
    const T = (await provisionTenant(client, { code: `t-por-${run}`, name: "Portál", adminEmail: `por-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap", "int"], company: { code: "P", name: "Odběratel s.r.o." } })).ctx;
    const p = await saveRecord(T, "int.portal", null, { name: "Portál dodavatelů", title: "Pošlete nám faktury", ipHourLimit: 3, maxFileMb: 50 }, undefined, client);
    expect(p.maxFileMb).toBe(10); // nad limit platformy se nejde
    expect(String(p.publicUrl)).toBe(`/portal/${T.tenantId}/${p.token}`);
    const info = await portalInfo(T.tenantId, String(p.token), client);
    expect([info?.companyName, info?.title, info?.kinds.map((k) => k.value)]).toEqual(["Odběratel s.r.o.", "Pošlete nám faktury", ["invoice", "advance", "order", "other"]]);
    expect(await portalInfo(T.tenantId, "neplatny-klic-0123456789", client)).toBeNull();

    const base = { kind: "invoice", regNo: "27082440", name: "Dodavatel a.s.", email: "fakturace@dodavatel.test", note: "Faktura za říjen" };
    // 1) přijato: PDF → doklad ke zpracování s odesílatelem a přílohou; spustitelný soubor odmítnut
    const r1 = await portalSubmit(T.tenantId, String(p.token), { ...base, files: [{ name: "FA-1.pdf", type: "application/pdf", data: pdf }, { name: "FA-1.pdf.exe", type: "application/octet-stream", data: Buffer.from("MZ") }] }, "10.0.0.1", client);
    expect(r1?.files.map((f) => f.ok)).toEqual([true, false]);
    const docs = (await listRecords(T, "int.document", { filter: { source: "portal" } }, client)).rows;
    expect(docs.map((d) => [d.target, d.senderName, d.senderRegNo, d.regNo, d.partnerName, d.senderEmail])).toEqual([["apInvoice", "Dodavatel a.s.", "27082440", "27082440", "Dodavatel a.s.", "fakturace@dodavatel.test"]]);
    expect((await listDocuRefs(T, "int.document", String(docs[0].id), client)).map((r) => r.name)).toEqual(["FA-1.pdf"]);
    // upozornění ve zvonečku
    expect((await listRecords(T, "sys.notification", {}, client)).rows.some((n) => String(n.title).includes("NotifyPortal") || String(n.message ?? "").includes("Dodavatel"))).toBe(true);

    // 2) chybné údaje: IČO, druh
    const r2 = await portalSubmit(T.tenantId, String(p.token), { ...base, regNo: "123", files: [{ name: "a.pdf", type: "application/pdf", data: pdf }] }, "10.0.0.1", client);
    expect(r2?.ok).toBe(false);
    expect(r2?.error).toContain("IČO");
    // 3) limit 3 soubory / pokusy za hodinu z adresy (počítá se každý soubor): další se odmítne bez zápisu
    await portalSubmit(T.tenantId, String(p.token), { ...base, kind: "nesmysl", files: [{ name: "a.pdf", type: "application/pdf", data: pdf }] }, "10.0.0.1", client);
    const r4 = await portalSubmit(T.tenantId, String(p.token), { ...base, files: [{ name: "b.pdf", type: "application/pdf", data: pdf }] }, "10.0.0.1", client);
    expect(r4?.error).toContain("příliš mnoho");
    // jiná adresa projde
    const r5 = await portalSubmit(T.tenantId, String(p.token), { ...base, files: [{ name: "c.pdf", type: "application/pdf", data: pdf }] }, "10.0.0.2", client);
    expect(r5?.ok).toBe(true);
    const log = (await listRecords(T, "int.portalUpload", { pageSize: 50 }, client)).rows;
    expect(log.filter((l) => l.status === "accepted").length).toBe(2);
    expect(log.filter((l) => l.status === "rejected").length).toBeGreaterThanOrEqual(2);
    expect(log.every((l) => !String(l.ipHash).includes("10.0.0"))).toBe(true);

    // 4) nový odkaz: starý přestane platit; vypnutý portál neplatí
    await runAction(T, "int.portal", String(p.id), "newToken", client);
    const p2 = (await getRecord(T, "int.portal", String(p.id), client))!;
    expect(p2.token).not.toBe(p.token);
    expect(await portalSubmit(T.tenantId, String(p.token), { ...base, files: [{ name: "d.pdf", type: "application/pdf", data: pdf }] }, "10.0.0.3", client)).toBeNull();
    await saveRecord(T, "int.portal", String(p.id), { ...p2, active: false }, undefined, client);
    expect(await portalInfo(T.tenantId, String(p2.token), client)).toBeNull();
  }, 120_000);

  it("vyhrazené adresy pokrývají všechny moduly a stránky aplikace", () => {
    for (const m of registry.modules.keys()) expect(RESERVED_PATHS.has(m), `modul ${m}`).toBe(true);
    const top = (dir: string) => readdirSync(join(process.cwd(), "src", "app", dir), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    const routes = [...top(""), ...top("(app)"), ...top("(pos)"), ...top("(print)")].filter((d) => !d.startsWith("(") && !d.startsWith("["));
    for (const r of routes) expect(RESERVED_PATHS.has(r), `stránka /${r}`).toBe(true);
  });

  it("jednoduchá adresa /<zkratka organizace>/<portál>, jedinečná napříč zákazníky", async () => {
    const mk = async (code: string) =>
      (await provisionTenant(client, { code: `t-${code}-${run}`, name: code, adminEmail: `${code}-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ap", "int", "org"], company: { code: "S", name: `Firma ${code}` } })).ctx;
    const A = await mk("sla");
    const B = await mk("slb");
    const slug = `kral${run}`.slice(0, 30);
    const entA = (await listRecords(A, "org.entity", {}, client)).rows[0];
    await saveRecord(A, "org.entity", String(entA.id), { ...entA, publicSlug: slug.toUpperCase() }, undefined, client);
    const p = await saveRecord(A, "int.portal", null, { name: "Doklady" }, undefined, client);
    expect([p.slug, p.publicUrl]).toEqual(["doklady", `/${slug}/doklady`]);
    expect((await portalInfo(slug, "doklady", client))?.companyName).toBe("Firma sla");
    const ok = await portalSubmit(slug, "doklady", { kind: "invoice", regNo: "27082440", name: "Dodavatel", email: "", note: "", files: [{ name: "f.pdf", type: "application/pdf", data: pdf }] }, "10.1.1.1", client);
    expect(ok?.ok).toBe(true);
    // jiný zákazník stejnou zkratku nedostane, vyhrazené slovo nejde
    const entB = (await listRecords(B, "org.entity", {}, client)).rows[0];
    await expect(saveRecord(B, "org.entity", String(entB.id), { ...entB, publicSlug: slug }, undefined, client)).rejects.toMatchObject({ label: "@ORG:SlugTaken" });
    await expect(saveRecord(B, "org.entity", String(entB.id), { ...entB, publicSlug: "bank" }, undefined, client)).rejects.toMatchObject({ fields: { publicSlug: "@ORG:PublicSlugHelp" } });
    // druhý portál téže firmy se stejnou adresou nejde, jiná adresa ano; změna zkratky přepočítá odkazy
    await expect(saveRecord(A, "int.portal", null, { name: "Duplicita", slug: "doklady" }, undefined, client)).rejects.toMatchObject({ label: "@INT:SlugTaken" });
    const p2 = await saveRecord(A, "int.portal", null, { name: "Faktury", slug: "faktury" }, undefined, client);
    expect(p2.publicUrl).toBe(`/${slug}/faktury`);
    const entA2 = (await getRecord(A, "org.entity", String(entA.id), client))!;
    await saveRecord(A, "org.entity", String(entA.id), { ...entA2, publicSlug: `${slug}x` }, undefined, client);
    expect((await getRecord(A, "int.portal", String(p.id), client))!.publicUrl).toBe(`/${slug}x/doklady`);
    expect(await portalInfo(slug, "doklady", client)).toBeNull();
    expect((await portalInfo(`${slug}x`, "doklady", client))?.companyName).toBe("Firma sla");
    // stará zkratka je volná pro jiného zákazníka
    await saveRecord(B, "org.entity", String(entB.id), { ...entB, publicSlug: slug }, undefined, client);
  }, 120_000);
});
