/**
 * Údržba: smazat zkušební účtenky pokladny — po celých směnách (směna, účtenky, řádky, zaúčtování uzávěrky).
 *
 *   npx tsx --conditions=react-server scripts/delete-receipts.ts <tenant> <kód firmy> [--od=RRRR-MM-DD] [--do=RRRR-MM-DD] [--apply]
 *
 * Bez --apply jen vypíše, co by se smazalo. Vybírá směny podle data otevření (bez --od/--do všechny směny firmy).
 * S --apply vše v jedné transakci: uzavřená směna → smaže se doklad uzávěrky (gl.trans, tax.trans, gl.voucher;
 * jen v otevřeném účetním období), pak řádky účtenek, účtenky a směna. Odkazy z ostatních záznamů (odložené nákupy…)
 * se vynulují; povinný odkaz z cizího záznamu nebo skladový pohyb z účtenky = konec bez změn (sklad řešit ručně).
 * Odeslané tržby EET zůstávají na straně správce daně. Cokoli selže → nic se nesmaže.
 */
import "dotenv/config";
import { ADMIN } from "../src/core/security";
import type { RecordData } from "../src/core/module";
import type { ObjectDef } from "../src/core/object";
import { forgetReads, inTenant, type Ctx } from "../src/server/data";
import { createPrisma, withTenant } from "../src/server/db";
import { companyModules } from "../src/server/modules";
import { registry } from "../src/registry";
import { assertOpenPeriod } from "../src/modules/gl/posting";

let enabled = new Set<string>();

/** pole všech objektů zapnutých modulů, která odkazují na daný objekt */
function refsTo(target: string) {
  const out: { obj: ObjectDef; field: string; mandatory: boolean }[] = [];
  for (const o of registry.objects.values())
    if (enabled.has(o.id.split(".")[0]))
      for (const [k, f] of Object.entries(o.fields)) if (f.edt.kind === "ref" && f.edt.refObject === target) out.push({ obj: o, field: k, mandatory: !!f.mandatory });
  return out;
}

const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? "")).slice(0, 10);

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const opt = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? null;
  const apply = process.argv.includes("--apply");
  const [from, to] = [opt("od"), opt("do")];
  const [tenantCode, companyCode] = args;
  if (!tenantCode || !companyCode) throw new Error("použití: <tenant> <kód firmy> [--od=RRRR-MM-DD] [--do=RRRR-MM-DD] [--apply]");
  const client = createPrisma();
  const t = await client.sysTenant.findUniqueOrThrow({ where: { code: tenantCode }, include: { modules: true, users: { where: { role: "admin" }, take: 1 } } });
  const c = await withTenant(t.id, (tx) => tx.sysCompany.findFirstOrThrow({ where: { tenantId: t.id, code: companyCode } }), client);
  const modules = await companyModules(t.id, c.id, t.modules.map((m) => m.moduleId), client);
  const ctx: Ctx = { tenantId: t.id, userId: t.users[0].id, companyId: c.id, role: "admin", perms: ADMIN, modules, extensions: new Set(), lang: "cs" };
  enabled = modules;
  if (!modules.has("pos")) throw new Error(`firma ${c.code} nemá zapnutou Pokladnu (moduly: ${[...modules].join(", ")})`);
  console.log(`${apply ? "MAZÁNÍ" : "NANEČISTO (bez --apply se nic nemaže)"} · tenant ${tenantCode} · firma ${c.code} ${c.name} · směny ${from ?? "od začátku"} – ${to ?? "dosud"}`);

  try {
    await inTenant(
      ctx,
      async (s) => {
        const api = s.sys().api();
        const regs = new Map((await api.find("pos.register", {}, { take: 500 })).map((r) => [String(r.id), r]));
        const shifts = (await api.find("pos.shift", {}, { take: 20000, orderBy: { shiftNum: "asc" } })).filter((x) => (!from || day(x.openDate) >= from) && (!to || day(x.openDate) <= to));
        if (!shifts.length) throw new Error("žádná směna v zadaném období");
        const shiftIds = new Set(shifts.map((x) => String(x.id)));
        const receipts = (await api.find("pos.receipt", {}, { take: 100000, orderBy: { receiptNum: "asc" } })).filter((r) => shiftIds.has(String(r.shiftId)));
        const receiptIds = new Set(receipts.map((r) => String(r.id)));
        const lines = receipts.length ? await api.find("pos.receiptLine", { receiptId: { in: [...receiptIds] } }, { take: 200000 }) : [];
        const lineIds = new Set(lines.map((l) => String(l.id)));
        const vouchers = shifts.filter((x) => x.voucherId).map((x) => String(x.voucherId));
        const voucherSet = new Set(vouchers);

        let sum = 0;
        for (const x of shifts) {
          const rs = receipts.filter((r) => String(r.shiftId) === String(x.id));
          console.log(`\nsměna ${x.shiftNum} · ${regs.get(String(x.registerId))?.code ?? ""} · ${day(x.openDate)} · ${x.status === "closed" ? `uzavřená, doklad ${x.voucherId ? "ano" : "ne"}` : "otevřená"} · účtenek ${rs.length}`);
          for (const r of rs) {
            sum += Number(r.amountPaid ?? 0);
            console.log(`  ${r.receiptNum} · ${day(r.date)} · ${r.paymentMethod} · ${r.amountPaid} Kč${r.eetStatus ? ` · EET ${r.eetStatus}` : ""}`);
          }
        }
        console.log(`\ncelkem: směn ${shifts.length}, účtenek ${receipts.length}, řádků ${lines.length}, ${sum.toFixed(2)} Kč, dokladů uzávěrky ${vouchers.length}`);

        const blockers: string[] = [];
        // skladové pohyby z účtenek (výdej) — mazání by rozhodilo zásobu a ocenění
        if (modules.has("whs") && receiptIds.size) {
          const moves = (await api.find("whs.trans", { sourceObject: "pos.receipt" }, { take: 100000 })).filter((m) => receiptIds.has(String(m.sourceId)));
          if (moves.length) blockers.push(`skladové pohyby z účtenek: ${moves.length} (vyřešit ručně, např. inventurou)`);
        }
        // doklady uzávěrky: otevřené období, zápisy a DPH
        const vRecs: RecordData[] = [];
        for (const id of vouchers) {
          const v = await api.get("gl.voucher", id);
          if (!v) continue;
          vRecs.push(v);
          try {
            await assertOpenPeriod(api, day(v.date));
          } catch {
            blockers.push(`doklad ${v.voucherNum ?? id} (${day(v.date)}) je v uzavřeném účetním období`);
          }
        }
        const glTrans = vouchers.length ? await api.find("gl.trans", { voucherId: { in: vouchers } }, { take: 200000 }) : [];
        const taxTrans = vouchers.length ? await api.find("tax.trans", { voucherId: { in: vouchers } }, { take: 200000 }) : [];
        // DPH uzávěrky v podaném přiznání (měsíc nebo čtvrtletí) — mazat nejde
        const returns = taxTrans.length ? await api.find("tax.return", { status: "filed" }, { take: 500 }) : [];
        for (const x of taxTrans) {
          const [y, m] = day(x.taxDate).split("-").map(Number);
          if (returns.some((r) => Number(r.year) === y && (Number(r.month) === m || (!r.month && Number(r.quarter) === Math.ceil(m / 3))))) {
            blockers.push(`DPH ${day(x.taxDate)} je v podaném přiznání`);
            break;
          }
        }
        if (vouchers.length) console.log(`zaúčtování k smazání: zápisů HK ${glTrans.length}, daňových transakcí ${taxTrans.length}`);

        // odkazy z ostatních záznamů na mazané záznamy
        const mine: Record<string, Set<string>> = { "pos.shift": shiftIds, "pos.receipt": receiptIds, "pos.receiptLine": lineIds, "gl.voucher": voucherSet };
        const own = new Set(["pos.receipt.shiftId", "pos.receiptLine.receiptId", "gl.trans.voucherId", "tax.trans.voucherId", "pos.shift.voucherId"]);
        const nulls: { obj: string; id: string; field: string; title: string }[] = [];
        for (const [target, ids] of Object.entries(mine)) {
          if (!ids.size) continue;
          for (const r of refsTo(target)) {
            if (own.has(`${r.obj.id}.${r.field}`)) continue;
            for (const rec of await api.find(r.obj.id, { [r.field]: { in: [...ids] } }, { take: 50000 })) {
              if (mine[r.obj.id]?.has(String(rec.id))) continue;
              if (r.mandatory) blockers.push(`${r.obj.id} ${rec[r.obj.titleField] ?? rec.id} → ${target} (${r.field})`);
              else nulls.push({ obj: r.obj.id, id: String(rec.id), field: r.field, title: String(rec[r.obj.titleField] ?? rec.id) });
            }
          }
        }
        if (nulls.length) {
          console.log(`\nvynulovat odkaz: ${nulls.length}`);
          for (const n of nulls.slice(0, 50)) console.log(`  ${n.obj} ${n.title} · ${n.field}`);
        }
        if (blockers.length) {
          console.log(`\nNEJDE SMAZAT:`);
          for (const b of blockers) console.log(`  ${b}`);
          throw new Error("zastaveno, nic se nesmazalo");
        }
        if (!apply) throw new Error("nanečisto — spusťte znovu s --apply");

        // zápis: vazby, zaúčtování uzávěrek, řádky, účtenky, směny
        const sql = async (table: string, col: string, ids: string[]) => {
          if (ids.length) await s.tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "${col}" = ANY($1::uuid[]) AND tenant_id = $2::uuid`, ids, ctx.tenantId);
        };
        for (const n of nulls) {
          const col = n.field.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
          await s.tx.$executeRawUnsafe(`UPDATE "${registry.objects.get(n.obj)!.table}" SET "${col}" = NULL WHERE id = $1::uuid AND tenant_id = $2::uuid`, n.id, ctx.tenantId);
        }
        // zaúčtované zápisy nejdou smazat přes datovou službu (zámek) — přímo, v jedné transakci s ostatním
        await s.tx.$executeRawUnsafe(`UPDATE "pos_shift" SET "voucher_id" = NULL WHERE id = ANY($1::uuid[]) AND tenant_id = $2::uuid`, [...shiftIds], ctx.tenantId);
        await sql("tax_trans", "voucher_id", vouchers);
        await sql("gl_trans", "voucher_id", vouchers);
        await sql("gl_voucher", "id", vouchers);
        await sql("pos_receipt_line", "receipt_id", [...receiptIds]);
        await sql("pos_receipt", "id", [...receiptIds]);
        await sql("pos_shift", "id", [...shiftIds]);
        forgetReads(s.tx);
        // stopa v historii změn
        await s.tx.sysAudit.create({ data: { tenantId: ctx.tenantId, objectId: "pos.shift", recordId: String(shifts[0].id), action: "delete", userId: ctx.userId, changes: { script: "delete-receipts", shifts: shifts.map((x) => String(x.shiftNum)), receipts: receipts.map((r) => String(r.receiptNum)), vouchers: vRecs.map((v) => String(v.voucherNum ?? v.id)) } } });
        console.log("\nsmazáno");
      },
      client,
    );
  } catch (e) {
    console.log(`\n${(e as Error).message}`);
    if (process.env.DEBUG) console.log((e as Error).stack);
    process.exitCode = apply ? 1 : 0;
  }
  await client.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
