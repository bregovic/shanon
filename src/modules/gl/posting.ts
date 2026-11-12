/**
 * Účtování do hlavní knihy. Jediná cesta, jak vzniká gl.voucher + gl.trans.
 * Volají ho deníky, a později i pomocné knihy (odběratelé, dodavatelé,
 * pokladna, majetek) — každá transakce má tak obraz v hlavní knize.
 */
import { fromCents, sumCents, toCents } from "@/core/money";
import { UserError, type DataApi, type ObjectHandlers, type RecordData } from "@/core/module";
import { convertCents, rateFor } from "@/modules/sys/currency";

export interface PostingLine {
  accountId: string;
  /** kladná = MD, záporná = D */
  amount: string;
  costCenterId?: string | null;
  text?: string | null;
  /** cizí měna řádku (null = účetní měna) a částka v ní */
  currencyId?: string | null;
  amountCur?: string | null;
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
      currencyId: (l.currencyId as string) ?? null,
    };
  });
}

/** Účetní měna firmy jako záznam sys.currency (podle kódu ve firmě). */
export async function accountingCurrencyId(data: DataApi, companyId: string | null): Promise<string | null> {
  const company = companyId ? await data.get("sys.company", companyId) : null;
  const [cur] = company ? await data.find("sys.currency", { code: company.currency }, { take: 1 }) : [];
  return cur ? String(cur.id) : null;
}

/** Řádky v cizí měně přepočte kurzem k datu; částka v měně zůstane v amountCur. */
export async function convertLines(data: DataApi, companyId: string | null, date: string, lines: PostingLine[]): Promise<PostingLine[]> {
  const base = await accountingCurrencyId(data, companyId);
  const out: PostingLine[] = [];
  for (const l of lines) {
    if (!l.currencyId || l.currencyId === base) {
      out.push({ ...l, currencyId: base, amountCur: l.amountCur ?? l.amount });
      continue;
    }
    const r = await rateFor(data, l.currencyId, date);
    const cur = l.amountCur ?? l.amount;
    out.push({ ...l, amountCur: cur, amount: fromCents(convertCents(cur, r.rate, r.amount)) });
  }
  return out;
}

/** Datum musí patřit do otevřeného účetního období. */
export async function assertOpenPeriod(data: DataApi, date: string): Promise<void> {
  const [p] = await data.find("gl.period", { startDate: { lte: date }, endDate: { gte: date } }, { take: 1 });
  if (!p) throw new UserError("@GL:NoPeriod", { date });
  if (p.status !== "open") throw new UserError("@GL:PeriodClosed", { period: String(p.code) });
}

/** Vytvoří měsíční období fiskálního roku (pokud žádná nemá). */
export async function createPeriods(data: DataApi, fy: RecordData): Promise<number> {
  if ((await data.find("gl.period", { fiscalYearId: fy.id }, { take: 1 })).length) throw new UserError("@GL:PeriodsExist");
  let n = 0;
  let d = new Date(`${fy.startDate}T00:00:00Z`);
  const end = new Date(`${fy.endDate}T00:00:00Z`);
  while (d <= end) {
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    const to = last < end ? last : end;
    const code = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    await data.create("gl.period", {
      fiscalYearId: fy.id,
      code,
      startDate: d.toISOString().slice(0, 10),
      endDate: to.toISOString().slice(0, 10),
      status: "open",
    });
    n++;
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  }
  return n;
}

export async function postVoucher(data: DataApi, req: PostingRequest): Promise<RecordData> {
  checkBalanced(req.lines);
  await assertOpenPeriod(data, req.date);
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
      currencyId: l.currencyId ?? null,
      amountCur: l.amountCur ?? null,
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
  "gl.fiscalYear": {
    beforeSave(_ctx, data) {
      if (data.startDate && data.endDate && String(data.endDate) < String(data.startDate)) return { endDate: "@SYS:InvalidDate" };
    },
    actions: {
      async periods(ctx, fy) {
        await createPeriods(ctx.data, fy);
      },
    },
  },
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
        const lines = await convertLines(
          ctx.data,
          ctx.companyId,
          String(journal.date),
          journalLinesToPosting(await ctx.data.find("gl.journalLine", { journalId: journal.id })),
        );
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
