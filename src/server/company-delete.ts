/**
 * Smazání firmy i se všemi daty (zkušební a předváděcí firmy) — Správa systému → Firmy → Další ▾ → Smazat firmu s daty.
 *
 * Jen superuživatel (sys.company je adminOnly, ověří runAction), potvrzení opsáním kódu firmy v UI.
 * Nejde smazat firmu, ve které je uživatel přihlášený, ani nosnou firmu virtuální společnosti.
 * Smaže všechno, co firmě patří: záznamy všech objektů firmy (doklady, zápisy hlavní knihy, DPH,
 * číselníky…), jejich přílohy a soubory v úložišti, přiřazení uživatelů, veřejné adresy a firmu.
 * Historie změn (sys_audit) zůstane — zapíše se do ní i samotné smazání.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError } from "@/core/module";
import { registry } from "@/registry";
import { prisma, withTenant } from "./db";
import type { Ctx } from "./data";
import { storageFor } from "./storage";

type Q = { $executeRawUnsafe(sql: string, ...v: unknown[]): Promise<number>; $queryRawUnsafe<T>(sql: string, ...v: unknown[]): Promise<T> };

export async function deleteCompanyWithData(ctx: Ctx, companyId: string, client: PrismaClient = prisma): Promise<{ rows: number }> {
  if (ctx.companyId === companyId) throw new UserError("@SYS:DeleteCompanyCurrent");
  const files: { storage: string; key: string }[] = [];
  let total = 0;
  try {
  await client.$transaction(
    async (tx) => {
      const q = tx as unknown as Q;
      await q.$executeRawUnsafe("SET LOCAL ROLE shanon_app");
      await q.$queryRawUnsafe("SELECT set_config('app.tenant_id', $1, true)", ctx.tenantId);
      const [company] = await q.$queryRawUnsafe<{ id: string; code: string; virtual: boolean }[]>(
        "SELECT id, code, virtual FROM sys_company WHERE id = $1::uuid AND tenant_id = $2::uuid",
        companyId,
        ctx.tenantId,
      );
      if (!company) throw new UserError("@SYS:NotFound");
      if (company.virtual) throw new UserError("@SYS:DeleteCompanyVirtual");

      // tabulky objektů firmy (scope company) — id záznamů kvůli přílohám
      const objects = [...registry.objects.values()].filter((o) => o.scope === "company");
      const tables = new Set(objects.map((o) => o.table));
      for (const o of objects) {
        const ids = (await q.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "${o.table}" WHERE company_id = $1::uuid`, companyId)).map((r) => r.id);
        if (!ids.length) continue;
        const refs = await q.$queryRawUnsafe<{ storage: string | null; storage_key: string | null }[]>(
          "DELETE FROM sys_docuref WHERE tenant_id = $1::uuid AND object_id = $2 AND record_id = ANY($3::uuid[]) RETURNING storage, storage_key",
          ctx.tenantId,
          o.id,
          ids,
        );
        for (const r of refs) if (r.storage_key) files.push({ storage: r.storage ?? "db", key: r.storage_key });
      }

      // odkazy mezi tabulkami firmy: nepovinné vynulovat (i stromy — nadřazená kategorie), pak mazat v kolech
      const fks = await q.$queryRawUnsafe<{ tbl: string; col: string; ref: string; nullable: boolean }[]>(
        `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.confrelid::regclass::text AS ref, NOT a.attnotnull AS nullable
           FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.contype = 'f'`,
      );
      const clean = (t: string) => t.replace(/^"|"$/g, "").replace(/^public\./, "");
      for (const fk of fks) {
        const t = clean(fk.tbl);
        if (!tables.has(t) || !fk.nullable || fk.col === "company_id" || !tables.has(clean(fk.ref))) continue;
        await q.$executeRawUnsafe(`UPDATE "${t}" SET "${fk.col}" = NULL WHERE company_id = $1::uuid AND "${fk.col}" IS NOT NULL`, companyId);
      }
      let left = [...tables];
      for (let round = 0; left.length && round < 50; round++) {
        const next: string[] = [];
        for (const t of left) {
          await q.$executeRawUnsafe("SAVEPOINT del_company");
          try {
            total += await q.$executeRawUnsafe(`DELETE FROM "${t}" WHERE company_id = $1::uuid`, companyId);
            await q.$executeRawUnsafe("RELEASE SAVEPOINT del_company");
          } catch {
            // na řádky ještě odkazuje jiná tabulka firmy — zkusit v dalším kole
            await q.$executeRawUnsafe("ROLLBACK TO SAVEPOINT del_company");
            next.push(t);
          }
        }
        if (next.length === left.length) throw new UserError("@SYS:DeleteCompanyBlocked", { tables: next.slice(0, 5).join(", ") });
        left = next;
      }

      // soubory v databázovém úložišti hned (RLS), vzdálené úložiště až po transakci
      const dbKeys = files.filter((f) => f.storage === "db").map((f) => f.key);
      if (dbKeys.length) await q.$executeRawUnsafe("DELETE FROM sys_file_blob WHERE tenant_id = $1::uuid AND id::text = ANY($2::text[])", ctx.tenantId, dbKeys);

      // systémové vazby firmy a firma sama (tabulky správy mimo roli aplikace; tenant zůstává nastavený, RLS platí)
      await q.$executeRawUnsafe("RESET ROLE");
      await q.$executeRawUnsafe("UPDATE sys_session SET company_id = NULL WHERE company_id = $1::uuid", companyId);
      await q.$executeRawUnsafe("DELETE FROM sys_user_company WHERE company_id = $1::uuid", companyId);
      await q.$executeRawUnsafe("DELETE FROM sys_company_module WHERE company_id = $1::uuid", companyId);
      await q.$executeRawUnsafe("DELETE FROM sys_global_key WHERE company_id = $1::uuid", companyId);
      // vlastní kurzy firmy smazat (vynulováním by se z nich staly společné kurzy všech firem)
      await q.$executeRawUnsafe("DELETE FROM sys_exchange_rate WHERE for_company_id = $1::uuid", companyId);
      // ostatní odkazy na firmu (členství ve virtuální společnosti…): nepovinné vynulovat, povinné vazby smazat
      for (const fk of fks) {
        const t = clean(fk.tbl);
        if (clean(fk.ref) !== "sys_company" || t === "sys_company" || tables.has(t)) continue;
        if (fk.nullable) await q.$executeRawUnsafe(`UPDATE "${t}" SET "${fk.col}" = NULL WHERE "${fk.col}" = $1::uuid`, companyId);
        else await q.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "${fk.col}" = $1::uuid`, companyId);
      }
      await q.$executeRawUnsafe("DELETE FROM sys_company WHERE id = $1::uuid AND tenant_id = $2::uuid", companyId, ctx.tenantId);
      await q.$executeRawUnsafe(
        `INSERT INTO sys_audit (id, tenant_id, object_id, record_id, action, user_id, changes, created_at)
         VALUES (gen_random_uuid(), $1::uuid, 'sys.company', $2::uuid, 'delete', $3::uuid, $4::jsonb, now())`,
        ctx.tenantId,
        companyId,
        ctx.userId,
        JSON.stringify({ code: company.code, deletedRows: total, files: files.length }),
      );
    },
    { timeout: 180_000, maxWait: 20_000 },
  );
  } catch (e) {
    // chyba databáze → srozumitelná hláška (transakce se vrátila, firma zůstala celá)
    if (e instanceof UserError) throw e;
    const m = /table "([^"]+)"/.exec(e instanceof Error ? e.message : "");
    throw new UserError("@SYS:DeleteCompanyBlocked", { tables: m?.[1] ?? "?" });
  }

  // vzdálené úložiště (R2…) až po potvrzení transakce
  for (const f of files.filter((x) => x.storage !== "db")) {
    try {
      await withTenant(ctx.tenantId, (tx) => storageFor(f.storage).remove(tx, ctx.tenantId, f.key), client);
    } catch {
      // nedostupné úložiště: soubor zůstane neodkazovaný, data firmy jsou pryč
    }
  }
  return { rows: total };
}
