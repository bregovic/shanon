/**
 * Výkonnostní test (jen test / lokální DB): založí samostatný tenant, nagenerujte data
 * a změří časy typických operací přes datovou službu (stejná cesta jako UI a API).
 *
 *   npx tsx --conditions=react-server scripts/perf.ts [--lines=400] [--invoices=300] [--subjects=3000]
 *
 * Výstup: tabulka operací s počtem, celkovým a průměrným časem (ms). Lokální PGlite má jedno
 * spojení a je pomalejší než Postgres — porovnávejte běhy mezi sebou, ne s produkcí.
 */
import "dotenv/config";
import { performance } from "node:perf_hooks";
import { getRecord, inTenant, listRecords, runAction, saveRecord, type Ctx } from "../src/server/data";
import { createPrisma } from "../src/server/db";
import { provisionTenant } from "../src/server/provision";
import { findReport } from "../src/server/report";
import { listProducts, quote } from "../src/modules/shop/catalog";

const arg = (n: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d);
const LINES = arg("lines", 400);
const INVOICES = arg("invoices", 300);
const SUBJECTS = arg("subjects", 3000);
const ITEMS = arg("items", 250);
const client = createPrisma();
const rows: [string, number, number][] = [];

async function time<T>(label: string, n: number, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const r = await fn();
  const ms = performance.now() - t0;
  rows.push([label, n, ms]);
  console.log(`${label.padEnd(52)} ${String(n).padStart(6)} × ${(ms / n).toFixed(1).padStart(8)} ms  (celkem ${(ms / 1000).toFixed(1)} s)`);
  return r;
}

async function main() {
  const run = Date.now().toString(36);
  const T: Ctx = (await provisionTenant(client, { code: `perf-${run}`, name: "Perf", adminEmail: `perf-${run}@test.local`, adminPassword: "heslo-12345", modules: ["ar", "ap", "bank", "cash", "whs", "inv", "shop"], company: { code: "P", name: "Perf s.r.o." } })).ctx;
  // dávkové úlohy tenanta vypnout (plánovač by je jinak spouštěl s ostatními tenanty)
  for (const j of (await listRecords(T, "sys.batchJob", { pageSize: 200 }, client)).rows) await saveRecord(T, "sys.batchJob", String(j.id), { active: false }, undefined, client);
  const acc = async (n: string) => String((await listRecords(T, "gl.account", { filter: { accountNum: n } }, client)).rows[0].id);
  const [a518, a395, a604] = [await acc("518000"), await acc("395000"), await acc("604000")];

  // adresář a odběratelé
  const [grp] = (await listRecords(T, "ar.group", {}, client)).rows;
  const customers: string[] = [];
  await time("adresář: subjekt + odběratel", SUBJECTS, async () => {
    for (let i = 0; i < SUBJECTS; i++) {
      const s = await saveRecord(T, "gab.subject", null, { name: `Odběratel ${i} ${i % 7 === 0 ? "Bistro" : "Masna"}`, regNo: String(10000000 + i) }, undefined, client);
      if (i < 200) customers.push(String((await saveRecord(T, "ar.customer", null, { subjectId: s.id, groupId: grp.id }, undefined, client)).id));
    }
  });

  // deník: řádky po dvou na doklad (číslo dokladu hned), Ověřit, Zaúčtovat
  const j = await saveRecord(T, "gl.journal", null, { date: "2026-11-15", description: "Výkon" }, undefined, client);
  await time("deník: nový řádek (číslo dokladu, kontrola účtu)", LINES, async () => {
    for (let i = 0; i < LINES; i++)
      await saveRecord(T, "gl.journalLine", null, { journalId: j.id, accountId: i % 2 ? a395 : a518, [i % 2 ? "credit" : "debit"]: String(100 + Math.floor(i / 2)), text: `Řádek ${i}` }, undefined, client);
  });
  await time("deník: Ověřit", 1, () => runAction(T, "gl.journal", String(j.id), "validate", client));
  console.log("   ", (await getRecord(T, "gl.journal", String(j.id), client))!.checkResult);
  await time("deník: Zaúčtovat", 1, () => runAction(T, "gl.journal", String(j.id), "post", client));

  // faktury: 3 řádky, zaúčtování
  const invIds: string[] = [];
  await time("faktura: hlavička + 3 řádky", INVOICES, async () => {
    for (let i = 0; i < INVOICES; i++) {
      const inv = await saveRecord(T, "ar.invoice", null, { customerId: customers[i % customers.length], invoiceDate: "2026-11-15" }, undefined, client);
      for (let k = 0; k < 3; k++) await saveRecord(T, "ar.invoiceLine", null, { invoiceId: inv.id, description: `Zboží ${k}`, qty: String(k + 1), unitPrice: "99.90", accountId: a604 }, undefined, client);
      invIds.push(String(inv.id));
    }
  });
  await time("faktura: Zaúčtovat", INVOICES, async () => {
    for (const id of invIds) await runAction(T, "ar.invoice", id, "post", client);
  });

  // seznamy (stejné volání jako mřížka)
  await time("seznam subjektů: 1. stránka + součty", 20, async () => {
    for (let i = 0; i < 20; i++) await listRecords(T, "gab.subject", { pageSize: 50, totals: true }, client);
  });
  await time("seznam subjektů: hledání „bistro 7“", 20, async () => {
    for (let i = 0; i < 20; i++) await listRecords(T, "gab.subject", { q: "bistro 7", pageSize: 50 }, client);
  });
  await time("seznam faktur: řazení podle částky + součty", 20, async () => {
    for (let i = 0; i < 20; i++) await listRecords(T, "ar.invoice", { sort: "amountGross", dir: "desc", pageSize: 50, totals: true }, client);
  });
  await time("zápisy HK: 2000 řádků (export)", 1, () => listRecords(T, "gl.trans", { pageSize: 2000, maxPageSize: 2000 }, client));
  await time("saldo odběratelů: filtr na odběratele", 20, async () => {
    for (let i = 0; i < 20; i++) await listRecords(T, "ar.trans", { filter: { customerId: customers[i] }, pageSize: 50 }, client);
  });

  // předvaha
  const tb = findReport("gl", "trialBalance");
  if (tb)
    await time("report: předvaha", 5, async () => {
      for (let i = 0; i < 5; i++) await inTenant(T, (s) => tb.run(s.sys().api(), { dateFrom: "2026-01-01", dateTo: "2026-12-31" }, { companyId: T.companyId, t: s.sys().eventCtx("gl.trans").t }), client);
    });

  // e-shop: katalog (cena, sleva, volná zásoba, MJ u každé položky), košík
  const [unit] = (await listRecords(T, "inv.unit", { pageSize: 1 }, client)).rows;
  const [igrp] = (await listRecords(T, "inv.itemGroup", { pageSize: 1 }, client)).rows;
  const [cat] = [await saveRecord(T, "inv.category", null, { code: "PERF", name: "Výkon" }, undefined, client)];
  const itemIds: string[] = [];
  await time("položka e-shopu (založení)", ITEMS, async () => {
    for (let i = 0; i < ITEMS; i++)
      itemIds.push(String((await saveRecord(T, "inv.item", null, { itemNum: `E${String(i).padStart(4, "0")}`, name: `Zboží ${i}`, salesPrice: String(50 + i), unitId: unit?.id ?? null, groupId: igrp?.id ?? null, categoryId: cat.id, eshop: true }, undefined, client)).id));
  });
  const shop = (await listRecords(T, "shop.shop", { pageSize: 1 }, client)).rows[0] ?? {};
  await time("e-shop: přehled (60 položek)", 10, async () => {
    for (let i = 0; i < 10; i++) await inTenant(T, (s) => listProducts(s.sys().api(), shop, { take: 60 }), client);
  });
  await time(`e-shop: kategorie (${ITEMS} položek)`, 10, async () => {
    for (let i = 0; i < 10; i++) await inTenant(T, (s) => listProducts(s.sys().api(), shop, { categoryId: String(cat.id) }), client);
  });
  await time("e-shop: košík 10 položek (quote)", 10, async () => {
    for (let i = 0; i < 10; i++) await inTenant(T, (s) => quote(s.sys().api(), shop, { lines: itemIds.slice(0, 10).map((itemId) => ({ itemId, qty: "2" })) }), client);
  });

  const total = rows.reduce((a, r) => a + r[2], 0);
  console.log(`\nCelkem ${(total / 1000).toFixed(1)} s · tenant perf-${run} (smazat: není potřeba, lokální DB)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
