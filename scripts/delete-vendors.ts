/**
 * Údržba: smazat dodavatele i s jeho doklady (zkušební / omylem založená data).
 *
 *   npx tsx --conditions=react-server scripts/delete-vendors.ts <tenant> <kód firmy> "<část názvu>" ["<část názvu>" …] [--apply]
 *
 * Bez --apply jen vypíše, co by se smazalo. S --apply vše v jedné transakci přes datovou službu
 * (události, historie změn): zaúčtované přijaté faktury nejdřív zruší zaúčtování (`unpostInvoice` —
 * odmítne uhrazenou fakturu, podané DPH, uzavřené období, pohyb skladu), pak smaže doklady
 * (faktury, zálohy, objednávky, položky salda, vytěžené doklady) a dodavatele. Odkazy z ostatních
 * záznamů (položky, řádky výpisu…) se vynulují; povinný odkaz z cizího záznamu = konec bez změn.
 * Subjekt v adresáři zůstává. Cokoli selže → nic se nesmaže.
 */
import "dotenv/config";
import { ADMIN } from "../src/core/security";
import type { RecordData } from "../src/core/module";
import type { ObjectDef } from "../src/core/object";
import { forgetReads, inTenant, type Ctx } from "../src/server/data";
import { createPrisma, withTenant } from "../src/server/db";
import { companyModules } from "../src/server/modules";
import { registry } from "../src/registry";
import { ap as apLedger } from "../src/modules/ap";
import { unpostInvoice } from "../src/modules/tax/document";

/** doklady dodavatele, které se mažou s ním (pořadí = pořadí mazání) */
const DOCS = ["int.document", "ap.invoice", "ap.order", "ap.advance", "ap.trans"];

/** zamčený doklad (lockedWhen) → hodnota, na kterou se před smazáním přepne */
const UNLOCK: Record<string, string> = { "int.document": "rejected" };

const norm =(s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** moduly firmy — objekty vypnutých modulů nemají data ani přístup */
let enabled = new Set<string>();

/** pole všech objektů, která odkazují na daný objekt */
function refsTo(target: string) {
  const out: { obj: ObjectDef; field: string; mandatory: boolean }[] = [];
  for (const o of registry.objects.values())
    if (enabled.has(o.id.split(".")[0]))
    for (const [k, f] of Object.entries(o.fields)) if (f.edt.kind === "ref" && f.edt.refObject === target) out.push({ obj: o, field: k, mandatory: !!f.mandatory });
  return out;
}

/** řádky, které patří dokladu a smažou se s ním (owned lines) */
const ownedLines = (objectId: string) => new Set((registry.objects.get(objectId)?.lines ?? []).filter((l) => l.owned !== false).map((l) => `${l.object}.${l.field}`));

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const apply = process.argv.includes("--apply");
  const [tenantCode, companyCode, ...names] = args;
  if (!tenantCode || !companyCode || !names.length) throw new Error("použití: <tenant> <kód firmy> \"<část názvu>\" … [--apply]");
  const client = createPrisma();
  const t = await client.sysTenant.findUniqueOrThrow({ where: { code: tenantCode }, include: { modules: true, users: { where: { role: "admin" }, take: 1 } } });
  const c = await withTenant(t.id, (tx) => tx.sysCompany.findFirstOrThrow({ where: { tenantId: t.id, code: companyCode } }), client);
  const modules = await companyModules(t.id, c.id, t.modules.map((m) => m.moduleId), client);
  const ctx: Ctx = { tenantId: t.id, userId: t.users[0].id, companyId: c.id, role: "admin", perms: ADMIN, modules, extensions: new Set(), lang: "cs" };
  enabled = modules;
  if (!modules.has("ap")) throw new Error(`firma ${c.code} nemá zapnuté Dodavatele (moduly: ${[...modules].join(", ")})`);
  console.log(`${apply ? "MAZÁNÍ" : "NANEČISTO (bez --apply se nic nemaže)"} · tenant ${tenantCode} · firma ${c.code} ${c.name}`);

  try {
    await inTenant(
      ctx,
      async (s) => {
        const api = s.sys().api();
        const subjects = new Map((await api.find("gab.subject", {}, { take: 20000 })).map((x) => [String(x.id), x]));
        const vendors = (await api.find("ap.vendor", {}, { take: 20000 })).filter((v) => {
          const name = norm(subjects.get(String(v.subjectId))?.name ?? v.name);
          return names.some((n) => name.includes(norm(n)));
        });
        if (!vendors.length) throw new Error("žádný dodavatel neodpovídá zadaným názvům");
        for (const v of vendors) console.log(`dodavatel ${v.accountNum ?? ""} · ${subjects.get(String(v.subjectId))?.name ?? ""} · IČO ${v.regNo ?? ""} (${v.id})`);

        // co smazat: dodavatelé + jejich doklady; co vynulovat: odkazy z ostatních záznamů
        const del = new Map<string, Map<string, RecordData>>(); // objekt → id → záznam
        const add = (o: string, r: RecordData) => (del.get(o) ?? del.set(o, new Map()).get(o)!).set(String(r.id), r);
        for (const v of vendors) add("ap.vendor", v);
        const nulls: { obj: string; id: string; field: string; title: string }[] = [];
        const blockers: string[] = [];
        const vendorIds = vendors.map((v) => String(v.id));

        // 1. záznamy s odkazem na dodavatele
        for (const r of refsTo("ap.vendor")) {
          for (const vid of vendorIds) {
            for (const rec of await api.find(r.obj.id, { [r.field]: vid }, { take: 5000 })) {
              if (DOCS.includes(r.obj.id)) add(r.obj.id, rec);
              else if (!r.mandatory) nulls.push({ obj: r.obj.id, id: String(rec.id), field: r.field, title: String(rec[r.obj.titleField] ?? rec.id) });
              else blockers.push(`${r.obj.id} ${rec[r.obj.titleField] ?? rec.id} (${r.field})`);
            }
          }
        }
        // 2. odkazy na mazané doklady z jiných záznamů (vlastní řádky dokladu se smažou s ním)
        //    i odkazy na ŘÁDKY mazaných dokladů (řádek příjemky → řádek objednávky): řádek se maže s dokladem
        const lineDel = new Map<string, Set<string>>();
        for (const [o, recs] of [...del]) {
          for (const l of (registry.objects.get(o)?.lines ?? []).filter((x) => x.owned !== false && enabled.has(x.object.split(".")[0])))
            for (const id of recs.keys())
              for (const line of await api.find(l.object, { [l.field]: id }, { take: 5000 })) (lineDel.get(l.object) ?? lineDel.set(l.object, new Set()).get(l.object)!).add(String(line.id));
        }
        const deleted = (o: string, id: string) => !!del.get(o)?.has(id) || !!lineDel.get(o)?.has(id);
        const targets: [string, string[]][] = [...[...del].filter(([o]) => o !== "ap.vendor").map(([o, m]) => [o, [...m.keys()]] as [string, string[]]), ...[...lineDel].map(([o, s]) => [o, [...s]] as [string, string[]])];
        for (const [o, ids] of targets) {
          const owned = ownedLines(o);
          for (const r of refsTo(o)) {
            if (owned.has(`${r.obj.id}.${r.field}`)) continue;
            for (const id of ids) {
              for (const rec of await api.find(r.obj.id, { [r.field]: id }, { take: 5000 })) {
                if (deleted(r.obj.id, String(rec.id))) continue;
                if (DOCS.includes(r.obj.id)) add(r.obj.id, rec);
                else if (!r.mandatory) nulls.push({ obj: r.obj.id, id: String(rec.id), field: r.field, title: String(rec[r.obj.titleField] ?? rec.id) });
                else blockers.push(`${r.obj.id} ${rec[r.obj.titleField] ?? rec.id} → ${o} (${r.field})`);
              }
            }
          }
        }

        for (const o of [...DOCS, "ap.vendor"]) {
          const recs = [...(del.get(o)?.values() ?? [])];
          if (!recs.length) continue;
          const def = registry.objects.get(o)!;
          console.log(`\nsmazat ${o}: ${recs.length}`);
          for (const r of recs) console.log(`  ${r[def.titleField] ?? r.id}${r.status ? ` · ${r.status}` : ""}${r.amountGross ? ` · ${r.amountGross}` : ""}${r.invoiceDate ? ` · ${String(r.invoiceDate).slice(0, 10)}` : ""}${r.kind ? ` · ${r.kind}` : ""}`);
        }
        const posted = [...(del.get("ap.invoice")?.values() ?? [])].filter((i) => i.status === "posted");
        if (posted.length) console.log(`\nzrušit zaúčtování (zápisy HK, DPH, saldo): ${posted.map((i) => i.invoiceNum).join(", ")}`);
        if (nulls.length) {
          console.log(`\nvynulovat odkaz: ${nulls.length}`);
          for (const n of nulls) console.log(`  ${n.obj} ${n.title} · ${n.field}`);
        }
        if (blockers.length) {
          console.log(`\nNEJDE SMAZAT — povinný odkaz z jiného záznamu:`);
          for (const b of blockers) console.log(`  ${b}`);
          throw new Error("zastaveno, nic se nesmazalo");
        }
        if (!apply) throw new Error("nanečisto — spusťte znovu s --apply");

        // zápis
        for (const inv of posted) await unpostInvoice(api, apLedger.cfg, inv);
        // jen vazba na mazaný doklad, ne úprava záznamu: zaúčtovaná příjemka by změnu přes uložení odmítla
        for (const n of nulls) {
          const col = n.field.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
          await s.tx.$executeRawUnsafe(`UPDATE "${registry.objects.get(n.obj)!.table}" SET "${col}" = NULL WHERE id = $1::uuid AND tenant_id = $2::uuid`, n.id, ctx.tenantId);
        }
        forgetReads(s.tx);
        for (const o of [...DOCS, "ap.vendor"]) {
          const lock = registry.objects.get(o)!.lockedWhen;
          for (const id of del.get(o)?.keys() ?? []) {
            const rec = await api.get(o, id);
            if (!rec) continue;
            // zalistovaný vytěžený doklad je zamčený (mazat ho nejde) — nejdřív Odmítnuto (systémová úprava zámek obejde)
            if (lock && rec[lock.field] === lock.equals && UNLOCK[o]) await api.update(o, id, { [lock.field]: UNLOCK[o] });
            await api.remove(o, id);
          }
        }
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
