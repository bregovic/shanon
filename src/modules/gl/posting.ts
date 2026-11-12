/**
 * Účtování do hlavní knihy. Jediná cesta, jak vzniká gl.voucher + gl.trans.
 * Volají ho deníky, a později i pomocné knihy (odběratelé, dodavatelé,
 * pokladna, majetek) — každá transakce má tak obraz v hlavní knize.
 */
import { fromCents, sumCents, toCents } from "@/core/money";
import { UserError, type DataApi, type ObjectHandlers, type RecordData } from "@/core/module";

export interface PostingLine {
  accountId: string;
  /** kladná = MD, záporná = D */
  amount: string;
  costCenterId?: string | null;
  text?: string | null;
}

export interface PostingRequest {
  date: string;
  description?: string | null;
  sourceObject?: string;
  sourceId?: string;
  /** konkrétní řada dokladů (z názvu deníku); jinak řada s Použitím „Účetní doklady“ */
  voucherSeqId?: string | null;
  lines: PostingLine[];
}

/** Kontrola bez přístupu k datům — vyrovnanost a neprázdnost. */
export function checkBalanced(lines: PostingLine[]): void {
  const nonZero = lines.filter((l) => toCents(l.amount) !== BigInt(0));
  if (nonZero.length === 0) throw new UserError("@GL:NoLines");
  const diff = sumCents(nonZero.map((l) => toCents(l.amount)));
  if (diff !== BigInt(0)) throw new UserError("@GL:NotBalanced", { diff: fromCents(diff) });
}

/** Řádky deníku (MD/D) → řádky účtování (znaménková částka). */
export function journalLinesToPosting(lines: RecordData[]): PostingLine[] {
  return lines.map((l, i) => {
    const debit = toCents(l.debit);
    const credit = toCents(l.credit);
    if (debit !== BigInt(0) && credit !== BigInt(0))
      throw new UserError("@GL:LineBothSides", { line: String(i + 1) });
    return {
      accountId: String(l.accountId),
      amount: fromCents(debit - credit),
      costCenterId: (l.costCenterId as string) ?? null,
      text: (l.text as string) ?? null,
    };
  });
}

export async function postVoucher(data: DataApi, req: PostingRequest): Promise<RecordData> {
  checkBalanced(req.lines);
  for (const l of req.lines) {
    const acc = await data.get("gl.account", l.accountId);
    if (!acc) throw new UserError("@SYS:InvalidValue");
    if (acc.blocked) throw new UserError("@GL:AccountBlocked", { account: String(acc.accountNum) });
  }
  const voucher = await data.create("gl.voucher", {
    // bez řady z deníku doplní číslo datová služba podle Použití (gl.voucher)
    voucherNum: req.voucherSeqId ? await data.nextNumber({ id: req.voucherSeqId }, new Date(req.date)) : null,
    date: req.date,
    description: req.description ?? null,
    sourceObject: req.sourceObject ?? null,
    sourceId: req.sourceId ?? null,
  });
  for (const l of req.lines) {
    if (toCents(l.amount) === BigInt(0)) continue;
    await data.create("gl.trans", {
      voucherId: voucher.id,
      date: req.date,
      accountId: l.accountId,
      costCenterId: l.costCenterId ?? null,
      amount: l.amount,
      text: l.text ?? req.description ?? null,
    });
  }
  return voucher;
}

/** Název deníku: zadaný, jinak GEN, jinak první nezablokovaný. */
async function resolveJournalName(data: DataApi, id: unknown): Promise<RecordData> {
  if (id) {
    const jn = await data.get("gl.journalName", String(id));
    if (jn) return jn;
  }
  const [gen] = await data.find("gl.journalName", { code: "GEN", blocked: false }, { take: 1 });
  const [first] = gen ? [gen] : await data.find("gl.journalName", { blocked: false }, { take: 1 });
  if (!first) throw new UserError("@GL:MissingJournalName");
  return first;
}

async function assertJournalOpen(data: DataApi, journalId: unknown) {
  const j = journalId ? await data.get("gl.journal", String(journalId)) : null;
  if (j?.status === "posted") throw new UserError("@GL:Locked");
}

export const glHandlers: Record<string, ObjectHandlers> = {
  "gl.journal": {
    async beforeSave(ctx, data) {
      const jn = await resolveJournalName(ctx.data, data.journalNameId);
      if (jn.blocked) return { journalNameId: "@GL:JournalNameBlocked" };
      data.journalNameId = jn.id;
    },
    actions: {
      async post(ctx, journal) {
        if (journal.status !== "draft") throw new UserError("@GL:Locked");
        const jn = await resolveJournalName(ctx.data, journal.journalNameId);
        if (jn.blocked) throw new UserError("@GL:JournalNameBlocked", { name: String(jn.code) });
        const lines = journalLinesToPosting(await ctx.data.find("gl.journalLine", { journalId: journal.id }));
        // protiúčet z nastavení deníku vyrovná rozdíl MD a D
        const diff = sumCents(lines.map((l) => toCents(l.amount)));
        if (diff !== BigInt(0) && jn.offsetAccountId) {
          lines.push({ accountId: String(jn.offsetAccountId), amount: fromCents(-diff), text: (journal.description as string) ?? null });
        }
        const voucher = await postVoucher(ctx.data, {
          date: String(journal.date),
          description: (journal.description as string) ?? null,
          sourceObject: "gl.journal",
          sourceId: String(journal.id),
          voucherSeqId: (jn.voucherSeqId as string) ?? null,
          lines,
        });
        await ctx.data.update("gl.journal", String(journal.id), { status: "posted", voucherId: voucher.id });
      },
    },
  },
  "gl.journalLine": {
    beforeSave: (ctx, data) => assertJournalOpen(ctx.data, data.journalId),
    beforeDelete: (ctx, data) => assertJournalOpen(ctx.data, data.journalId),
  },
};
