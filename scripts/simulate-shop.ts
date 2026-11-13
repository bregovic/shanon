/**
 * Simulace provozního dne prodejny (kasa, boxy, pokladní kniha, faktury)
 * nad existující firmou a kontrola výsledků (předvaha, DPH, pokladna).
 * Jen pro testovací prostředí — zakládá skutečné doklady.
 *
 *   npx tsx --conditions=react-server scripts/simulate-shop.ts <tenant> <kód firmy> [--receipts=60] [--seed=1]
 *
 * Používá položky firmy s prodejní cenou; nic konkrétního o firmě neobsahuje.
 */
import "dotenv/config";
import { fromCents, toCents } from "../src/core/money";
import type { DataApi } from "../src/core/module";
import { ADMIN } from "../src/core/security";
import { dependencyClosure } from "../src/core/module";
import { registry } from "../src/registry";
import { inTenant, type Ctx } from "../src/server/data";
import { createPrisma, withTenant } from "../src/server/db";
import { closeShift, openShiftOf, sell, shiftTotals } from "../src/modules/pos/sale";
import { saveBasket } from "../src/modules/pos/basket";
import { postCashVoucher, deskBalance } from "../src/modules/cash/handlers";
import { computeVat } from "../src/modules/tax/vat-return";

const arg = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
let seed = Number(arg("seed", "1"));
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const zero = BigInt(0);
const problems: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${msg}`);
  if (!ok) problems.push(msg);
};

async function main() {
  const [tenantCode, companyCode] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!tenantCode || !companyCode) throw new Error("použití: simulate-shop.ts <tenant> <firma>");
  const client = createPrisma();
  const tenant = await client.sysTenant.findUniqueOrThrow({ where: { code: tenantCode }, include: { modules: true, users: { where: { role: "admin" }, take: 1 } } });
  const modules = dependencyClosure(registry, ["sys", ...tenant.modules.map((m) => m.moduleId)]);
  const company = await withTenant(tenant.id, (tx) => tx.sysCompany.findFirstOrThrow({ where: { tenantId: tenant.id, code: companyCode } }), client);
  const ctx: Ctx = { tenantId: tenant.id, userId: tenant.users[0]?.id ?? tenant.id, userName: "Simulace", companyId: company.id, role: "admin", perms: ADMIN, modules, extensions: new Set(), lang: "cs" };
  const today = new Date().toISOString().slice(0, 10);
  const run = <T,>(fn: (d: DataApi) => Promise<T>) => inTenant(ctx, (s) => fn(s.sys().api()), client);

  console.log(`Simulace: ${tenant.code}/${company.code}, ${today}`);
  const items = (await run((d) => d.find("inv.item", { blocked: false }, { take: 2000 }))).filter((i) => i.salesPrice !== null && Number(i.salesPrice) > 0);
  if (!items.length) throw new Error("firma nemá položky s prodejní cenou");
  const [reg] = await run((d) => d.find("pos.register", { blocked: false }, { take: 1 }));
  if (!reg) throw new Error("firma nemá pokladnu");

  // 1) směna
  let shift = await run((d) => openShiftOf(d, String(reg.id)));
  if (!shift) shift = await run((d) => d.create("pos.shift", { registerId: reg.id, openingCash: "2000" }));
  console.log(`• směna ${shift.shiftNum} (pokladna ${reg.code})`);

  // 2) prodeje: 1–5 položek, vážené 0,1–1,2 kg, 70 % hotově
  const n = Number(arg("receipts", "60"));
  let sold = 0;
  for (let i = 0; i < n; i++) {
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => {
      const it = pick(items);
      const qty = it.weighed ? (0.1 + Math.round(rnd() * 110) / 100).toFixed(2) : String(1 + Math.floor(rnd() * 3));
      return { itemId: String(it.id), qty };
    });
    const cash = rnd() < 0.7;
    try {
      await run((d) => sell(d, { registerId: String(reg.id), payment: cash ? "cash" : "card", lines }));
      sold++;
    } catch (e) {
      problems.push(`prodej ${i + 1}: ${(e as { label?: string }).label ?? String(e)}`);
    }
  }
  console.log(`• prodáno ${sold}/${n} účtenek`);

  // 3) odložené nákupy (boxy / jména) a jejich zaplacení
  // jen volné boxy (bez rozpracovaného nákupu) a jedinečné jméno zákazníka
  const busy = new Set((await run((d) => d.find("pos.basket", { status: "open" }, { take: 200 }))).map((b) => String(b.boxId)));
  const boxes = (await run((d) => d.find("pos.box", { active: true }, { take: 50 }))).filter((b) => !busy.has(String(b.id))).slice(0, 3);
  for (const [k, label] of [`Zákazník ${Date.now() % 10000}`, ...boxes.map((b) => String(b.code))].entries()) {
    try {
      const b = await run((d) => saveBasket(d, { label, boxCode: label, registerId: String(reg.id), lines: [{ itemId: String(pick(items).id), qty: "1" }] }));
      await run((d) => saveBasket(d, { id: b.id, version: b.version, registerId: String(reg.id), lines: [...b.lines, { itemId: String(pick(items).id), qty: "2" }] }));
      const fresh = (await run((d) => d.find("pos.basket", { status: "open", label: b.label }, { take: 1 })))[0];
      const bl = await run((d) => d.find("pos.basketLine", { basketId: fresh.id }, { take: 50 }));
      await run((d) => sell(d, { registerId: String(reg.id), payment: k % 2 ? "card" : "cash", basketId: String(fresh.id), lines: bl.map((l) => ({ itemId: String(l.itemId), qty: String(l.qty) })) }));
    } catch (e) {
      problems.push(`box ${label}: ${(e as { label?: string }).label ?? String(e)}`);
    }
  }
  const open = await run((d) => d.find("pos.basket", { status: "open" }, { take: 50 }));
  console.log(`• odložené nákupy zaplaceny, zbývá otevřených: ${open.length}`);

  // 4) kontrola směny a uzávěrka
  const t = await run((d) => shiftTotals(d, String(shift.id)));
  const receipts = await run((d) => d.find("pos.receipt", { shiftId: shift.id }, { take: 5000 }));
  const sumPaid = receipts.reduce((a, r) => a + toCents(r.amountPaid), zero);
  const sumGross = receipts.reduce((a, r) => a + toCents(r.amountGross), zero);
  check(t.cash + t.card === sumPaid, `směna: hotově + kartou (${fromCents(t.cash + t.card)}) = zaplaceno na účtenkách (${fromCents(sumPaid)})`);
  check(sumPaid - sumGross === t.rounding, `zaokrouhlení hotovosti ${fromCents(t.rounding)} = rozdíl zaplaceno − tržba`);
  for (const r of receipts) {
    if (r.paymentMethod === "cash" && toCents(r.amountPaid) % BigInt(100) !== zero) problems.push(`účtenka ${r.receiptNum}: hotovost není na koruny`);
  }
  await run((d) => closeShift(d, shift));
  const closed = (await run((d) => d.get("pos.shift", String(shift.id))))!;
  check(closed.status === "closed" && !!closed.voucherId, `uzávěrka směny ${closed.shiftNum}: zaúčtováno`);

  // 5) pokladní kniha: výdej s DPH, odvod tržby do banky
  if (modules.has("cash")) {
    const [desk] = await run((d) => d.find("cash.desk", {}, { take: 1 }));
    const acc = async (num: string) => String((await run((d) => d.find("gl.account", { accountNum: num }, { take: 1 })))[0]?.id ?? "");
    const [p21] = await run((d) => d.find("tax.taxCode", { code: "P21" }, { take: 1 }));
    const a501 = await acc("501000");
    const a261 = await acc("261000");
    const before = await run((d) => deskBalance(d, desk, today));
    const exp = await run((d) => d.create("cash.voucher", { deskId: desk.id, direction: "out", date: today, description: "Čisticí prostředky", partnerName: "Drogerie", amount: "242", offsetAccountId: a501, taxCodeId: p21?.id ?? null }));
    await run(async (d) => postCashVoucher(d, (await d.get("cash.voucher", String(exp.id)))!));
    const bal = await run((d) => deskBalance(d, desk, today));
    const deposit = bal - BigInt(200000) > zero ? bal - BigInt(200000) : zero;
    if (deposit > zero) {
      const dep = await run((d) => d.create("cash.voucher", { deskId: desk.id, direction: "out", date: today, description: "Odvod tržby do banky", amount: fromCents(deposit), offsetAccountId: a261 }));
      await run(async (d) => postCashVoucher(d, (await d.get("cash.voucher", String(dep.id)))!));
    }
    const after = await run((d) => deskBalance(d, desk, today));
    check(after >= zero, `pokladna ${desk.code}: zůstatek ${fromCents(before)} → ${fromCents(after)} (nikdy pod nulou)`);
    try {
      const big = await run((d) => d.create("cash.voucher", { deskId: desk.id, direction: "out", date: today, description: "Příliš velký výdej", amount: fromCents(after + BigInt(100)), offsetAccountId: a501 }));
      await run(async (d) => postCashVoucher(d, (await d.get("cash.voucher", String(big.id)))!));
      check(false, "výdej nad zůstatek se měl odmítnout");
    } catch {
      check(true, "výdej nad zůstatek pokladny se odmítne");
    }
  }

  // 6) faktura dodavatele (nákup zboží)
  if (modules.has("ap")) {
    const [vendor] = await run((d) => d.find("ap.vendor", {}, { take: 1 }));
    if (vendor) {
      const inv = await run((d) => d.create("ap.invoice", { vendorId: vendor.id, invoiceDate: today, externalNum: `SIM-${Date.now() % 100000}` }));
      for (const it of items.slice(0, 3)) await run((d) => d.create("ap.invoiceLine", { invoiceId: inv.id, itemId: it.id, description: String(it.name), qty: "5", unitPrice: it.purchasePrice ? String(it.purchasePrice) : (Number(it.salesPrice) * 0.6).toFixed(2) }));
      try {
        await inTenant(ctx, (s) => s.action("ap.invoice", String(inv.id), "post"), client);
        check(true, `faktura dodavatele ${vendor.accountNum}: zaúčtována`);
      } catch (e) {
        check(false, `faktura dodavatele: ${(e as { label?: string }).label ?? String(e)}`);
      }
    }
  }

  // 7) kontroly hlavní knihy a DPH
  const trans = await run((d) => d.find("gl.trans", { date: { lte: today } }, { take: 500000 }));
  const total = trans.reduce((a, tr) => a + toCents(tr.amount), zero);
  check(total === zero, `předvaha: součet všech zápisů = 0 (${fromCents(total)})`);
  const vouchers = new Map<string, bigint>();
  for (const tr of trans) vouchers.set(String(tr.voucherId), (vouchers.get(String(tr.voucherId)) ?? zero) + toCents(tr.amount));
  const unbalanced = [...vouchers].filter(([, v]) => v !== zero);
  check(!unbalanced.length, `každý účetní doklad vyrovnaný (${vouchers.size} dokladů)`);
  if (modules.has("tax")) {
    try {
      const [y, m] = today.split("-").map(Number);
      const vat = await run((d) => computeVat(d, { year: y, month: m }));
      const r = vat.rows;
      console.log(`• DPH ${m}/${y}: výstup 21 % ${fromCents(r.out21[1])}, 12 % ${fromCents(r.out12[1])}; odpočet 21 % ${fromCents(r.in21[1])}, 12 % ${fromCents(r.in12[1])}; KH A.5 ${JSON.stringify(vat.a5, (_, v) => (typeof v === "bigint" ? fromCents(v) : v))}`);
      if (vat.warnings.length) console.log(`  varování DPH: ${vat.warnings.join(" | ")}`);
      // DPH z účtenek uzavřené směny musí sedět s daňovými transakcemi směny
      const tt = await run((d) => d.find("tax.trans", { sourceObject: "pos.shift", sourceId: String(shift.id) }, { take: 50 }));
      const ttTax = tt.reduce((a, x) => a + toCents(x.tax), zero);
      const rcTax = receipts.reduce((a, x) => a + toCents(x.taxAmount), zero);
      check(ttTax === rcTax, `DPH směny: daňové transakce ${fromCents(ttTax)} = DPH na účtenkách ${fromCents(rcTax)}`);
    } catch (e) {
      problems.push(`DPH: ${(e as { label?: string }).label ?? String(e)}`);
    }
  }
  console.log(problems.length ? `\nProblémy (${problems.length}):\n- ${problems.join("\n- ")}` : "\nBez problémů.");
  await client.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
