/**
 * Náhled dokladu: zaúčtování nanečisto (akce `ObjectDef.postingPreview`, např. Zaúčtovat)
 * v transakci, která se vrátí — ukáže přesně ty účetní zápisy a DPH, které by vznikly,
 * nebo chybu, kvůli které by zaúčtování neprošlo. Nic se nezapíše ani nespotřebuje.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError, type RecordData } from "@/core/module";
import { fromCents, toCents } from "@/core/money";
import { getObject, inTenant, type Ctx } from "./data";

export interface PostingPreview {
  vouchers: { voucherNum: string; date: string; lines: { account: string; debit: string | null; credit: string | null; text: string }[] }[];
  tax: { code: string; base: string; tax: string; direction: string }[];
}

class Rollback {
  constructor(readonly value: PostingPreview) {}
}

export async function previewPosting(ctx: Ctx, objectId: string, id: string, client?: PrismaClient): Promise<PostingPreview> {
  const def = getObject(objectId);
  if (!def.postingPreview) throw new UserError("@SYS:InvalidValue");
  try {
    await inTenant(
      ctx,
      async (s) => {
        await s.action(objectId, id, def.postingPreview!);
        const sys = s.sys();
        const vouchers = await sys.find("gl.voucher", { sourceObject: objectId, sourceId: id }, 100);
        const out: PostingPreview = { vouchers: [], tax: [] };
        const transDef = getObject("gl.trans");
        const taxDef = getObject("tax.trans");
        for (const v of vouchers) {
          const trans = await sys.find("gl.trans", { voucherId: v.id }, 2000);
          await sys.attachRefTitles(transDef, trans);
          out.vouchers.push({
            voucherNum: String(v.voucherNum ?? ""),
            date: String(v.date ?? ""),
            lines: trans.map((t) => {
              const c = toCents(t.amount ?? 0);
              return {
                account: String((t._titles as RecordData | undefined)?.accountId ?? ""),
                debit: c > BigInt(0) ? fromCents(c) : null,
                credit: c < BigInt(0) ? fromCents(-c) : null,
                text: String(t.text ?? ""),
              };
            }),
          });
          const tax = await sys.find("tax.trans", { voucherId: v.id }, 500).catch(() => [] as RecordData[]);
          await sys.attachRefTitles(taxDef, tax);
          for (const x of tax)
            out.tax.push({ code: String((x._titles as RecordData | undefined)?.taxCodeId ?? ""), base: String(x.base ?? "0"), tax: String(x.tax ?? "0"), direction: String(x.direction ?? "") });
        }
        throw new Rollback(out);
      },
      client,
    );
  } catch (e) {
    if (e instanceof Rollback) return e.value;
    throw e;
  }
  return { vouchers: [], tax: [] };
}
