/**
 * Banka: import výpisu, párování a zaúčtování úhrad.
 *
 * Párování (automat) — jen jednoznačné: příjem → otevřená faktura odběratele
 * se stejným VS, výdej → faktura dodavatele se stejným VS; když VS sedí na
 * víc faktur, nechá řádek na ručním párování (jeden VS mívá víc dokladů).
 *
 * Zaúčtování: banka proti pohledávce / závazku (účet ze skupiny partnera)
 * nebo proti zadanému účtu; úhrada se zapíše do salda (položka „Úhrada“)
 * a u faktury se navýší Uhrazeno, při plné úhradě se položka vyrovná.
 */
import { fromCents, sumCents, toCents } from "@/core/money";
import { UserError, type DataApi, type ObjectHandlers, type RecordData, type ValidationErrors } from "@/core/module";
import { convertLines, postVoucher, type PostingLine } from "@/modules/gl/posting";
import { checkStatement, decodeGpc, parseGpc } from "./gpc";
import { advanceAccount, recordAdvancePayment } from "@/modules/tax/orders";
import { checkStatementChain, journalFromStatement } from "./payments";

const zero = BigInt(0);

/** "19-123456789/0800" → "19000123456789" (jako číslo účtu v GPC, bez vodicích nul). */
export function gpcAccountKey(accountNum: string): string {
  const [left] = accountNum.split("/");
  const [prefix, num] = left.includes("-") ? left.split("-") : ["", left];
  return (prefix.padStart(6, "0") + num.padStart(10, "0")).replace(/^0+/, "");
}

async function assertDraft(data: DataApi, statementId: unknown) {
  const st = statementId ? await data.get("bank.statement", String(statementId)) : null;
  if (st?.status === "posted") throw new UserError("@GL:Locked");
  return st;
}

/** Obraty a konečný zůstatek výpisu z jeho řádků. */
export async function recalcStatement(data: DataApi, statementId: string) {
  const st = await data.get("bank.statement", statementId);
  if (!st) return;
  const lines = await data.find("bank.statementLine", { statementId });
  const amounts = lines.map((l) => toCents(l.amount));
  const credit = sumCents(amounts.filter((a) => a > zero));
  const debit = -sumCents(amounts.filter((a) => a < zero));
  await data.update("bank.statement", statementId, {
    credit: fromCents(credit),
    debit: fromCents(debit),
    closingBalance: fromCents(toCents(st.openingBalance) + credit - debit),
  });
}

/** Otevřená položka: zbývá uhradit (v měně faktury). */
const remaining = (t: RecordData) => toCents(t.amountCur ?? t.amount) - toCents(t.paidAmount);

/** Automatické párování nespárovaných řádků výpisu. Vrací počet spárovaných. */
export async function autoMatch(data: DataApi, statementId: string): Promise<number> {
  let n = 0;
  for (const line of await data.find("bank.statementLine", { statementId })) {
    if (line.matchKind && line.matchKind !== "none") continue;
    if (!line.vs) continue;
    const amount = toCents(line.amount);
    const incoming = amount > zero;
    const obj = incoming ? "ar.trans" : "ap.trans";
    // VS položky; u starších faktur bez VS číslice z čísla dokladu (stejně jako se VS dopočítává)
    const vsOf = (t: RecordData) => (t.vs as string) || String(t.documentNum ?? "").replace(/\D/g, "").slice(-10);
    const candidates = (await data.find(obj, { kind: "invoice", closed: false }, { take: 5000 })).filter(
      (t) => vsOf(t) === line.vs && remaining(t) > zero,
    );
    if (!candidates.length) {
      // jinak neuhrazená záloha se stejným VS
      const advObj = incoming ? "ar.advance" : "ap.advance";
      const advs = (await data.find(advObj, { vs: line.vs, status: "open" }, { take: 2 })) as RecordData[];
      if (advs.length === 1) {
        await data.update("bank.statementLine", String(line.id), {
          [incoming ? "customerAdvanceId" : "vendorAdvanceId"]: advs[0].id,
          matchKind: incoming ? "customerAdvance" : "vendorAdvance",
        });
        n++;
      }
      continue;
    }
    if (candidates.length !== 1) continue; // víc dokladů se stejným VS → ručně
    await data.update("bank.statementLine", String(line.id), {
      [incoming ? "customerTransId" : "vendorTransId"]: candidates[0].id,
      matchKind: incoming ? "customer" : "vendor",
    });
    n++;
  }
  return n;
}

/** Import GPC: kontrola součtů, kontrola účtu, výpis s řádky, automatické párování. */
export async function importStatement(data: DataApi, account: RecordData, file: Buffer): Promise<string[]> {
  const statements = parseGpc(decodeGpc(file));
  if (!statements.length) throw new UserError("@BANK:ImportNoStatement");
  // nejdřív zkontrolovat všechny — vadný soubor se neuloží ani zčásti
  for (const s of statements) {
    const problem = checkStatement(s);
    if (problem) throw new UserError("@BANK:ImportCheck", { num: s.statementNum, detail: problem });
    if (account.accountNum && gpcAccountKey(String(account.accountNum)) !== s.account) {
      throw new UserError("@BANK:ImportOtherAccount", { file: s.account, account: String(account.accountNum) });
    }
    if ((await data.find("bank.statement", { bankAccountId: account.id, statementNum: s.statementNum }, { take: 1 })).length) {
      throw new UserError("@BANK:ImportDuplicate", { num: s.statementNum });
    }
  }
  const ids: string[] = [];
  for (const s of statements) {
    const st = await data.create("bank.statement", {
      bankAccountId: account.id,
      statementNum: s.statementNum,
      date: s.date,
      openingBalance: fromCents(s.opening),
    });
    for (const l of s.lines) {
      await data.create("bank.statementLine", {
        statementId: st.id,
        lineNum: l.lineNum,
        date: l.date,
        amount: fromCents(l.cents),
        vs: l.vs && /^\d{1,10}$/.test(l.vs) ? l.vs : null,
        counterAccount: l.counterAccount,
        message: l.message,
      });
    }
    await recalcStatement(data, String(st.id));
    await autoMatch(data, String(st.id));
    ids.push(String(st.id));
  }
  return ids;
}

/** Účet pohledávek / závazků partnera otevřené položky (ze skupiny). */
async function summaryAccount(data: DataApi, trans: RecordData, kind: "customer" | "vendor") {
  const partner = await data.get(kind === "customer" ? "ar.customer" : "ap.vendor", String(trans[`${kind}Id`]));
  const group = partner ? await data.get(kind === "customer" ? "ar.group" : "ap.group", String(partner.groupId)) : null;
  const acc = group?.[kind === "customer" ? "receivableAccountId" : "payableAccountId"];
  if (!acc) throw new UserError("@SYS:InvalidValue");
  return String(acc);
}

export async function postStatement(data: DataApi, companyId: string | null, st: RecordData) {
  if (st.status !== "draft") throw new UserError("@GL:Locked");
  const account = await data.get("bank.account", String(st.bankAccountId));
  if (!account) throw new UserError("@SYS:InvalidValue");
  const lines = await data.find("bank.statementLine", { statementId: st.id }, { orderBy: { lineNum: "asc" } });
  if (!lines.length) throw new UserError("@GL:NoLines");
  const open = lines.filter((l) => !l.matchKind || l.matchKind === "none");
  if (open.length) throw new UserError("@BANK:Unmatched", { lines: open.map((l) => String(l.lineNum ?? "?")).join(", ") });

  const cur = (account.currencyId as string) ?? null;
  const posting: PostingLine[] = [];
  for (const l of lines) {
    const text = [l.vs ? `VS ${l.vs}` : null, l.message].filter(Boolean).join(" · ") || null;
    let other: string;
    if (l.matchKind === "customer") other = await summaryAccount(data, (await data.get("ar.trans", String(l.customerTransId)))!, "customer");
    else if (l.matchKind === "vendor") other = await summaryAccount(data, (await data.get("ap.trans", String(l.vendorTransId)))!, "vendor");
    else if (l.matchKind === "customerAdvance") other = await advanceAccount(data, "customer", String(l.customerAdvanceId));
    else if (l.matchKind === "vendorAdvance") other = await advanceAccount(data, "vendor", String(l.vendorAdvanceId));
    else other = String(l.offsetAccountId);
    posting.push({ accountId: String(account.glAccountId), amount: String(l.amount), currencyId: cur, text });
    posting.push({ accountId: other, amount: fromCents(-toCents(l.amount)), currencyId: cur, text });
  }
  const converted = await convertLines(data, companyId, String(st.date), posting);
  const voucher = await postVoucher(data, {
    date: String(st.date),
    description: `${account.code} · ${st.statementNum}`,
    sourceObject: "bank.statement",
    sourceId: String(st.id),
    lines: converted,
  });

  // úhrady do salda: položka „Úhrada“ + navýšení Uhrazeno u faktury
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.matchKind === "customerAdvance" || l.matchKind === "vendorAdvance") {
      const isCust = l.matchKind === "customerAdvance";
      const sign = isCust ? BigInt(1) : BigInt(-1);
      await recordAdvancePayment(data, isCust ? "customer" : "vendor", String(isCust ? l.customerAdvanceId : l.vendorAdvanceId), {
        paidCur: sign * toCents(l.amount),
        paidAcc: sign * toCents(converted[i * 2].amount),
        voucherId: String(voucher.id),
        documentNum: `${account.code}/${st.statementNum}/${l.lineNum ?? i + 1}`,
        date: l.date,
        vs: l.vs ?? null,
        currencyId: cur,
      });
      continue;
    }
    if (l.matchKind !== "customer" && l.matchKind !== "vendor") continue;
    const isCust = l.matchKind === "customer";
    const obj = isCust ? "ar.trans" : "ap.trans";
    const partnerField = isCust ? "customerId" : "vendorId";
    const inv = (await data.get(obj, String(isCust ? l.customerTransId : l.vendorTransId)))!;
    const paid = isCust ? toCents(l.amount) : -toCents(l.amount); // kladná uhrazená částka
    const paidAcc = isCust ? toCents(converted[i * 2].amount) : -toCents(converted[i * 2].amount);
    const newPaid = toCents(inv.paidAmount) + paid;
    await data.update(obj, String(inv.id), {
      paidAmount: fromCents(newPaid),
      closed: newPaid >= toCents(inv.amountCur ?? inv.amount),
    });
    if (inv.invoiceId) await data.update(isCust ? "ar.invoice" : "ap.invoice", String(inv.invoiceId), { paidAmount: fromCents(newPaid) });
    await data.create(obj, {
      [partnerField]: inv[partnerField],
      kind: "payment",
      invoiceId: inv.invoiceId ?? null,
      voucherId: voucher.id,
      documentNum: `${account.code}/${st.statementNum}/${l.lineNum ?? i + 1}`,
      vs: l.vs ?? null,
      date: l.date,
      currencyId: cur ?? inv.currencyId ?? null,
      amount: fromCents(-paidAcc),
      amountCur: fromCents(-paid),
      paidAmount: "0",
      closed: true,
    });
  }
  await data.update("bank.statement", String(st.id), { status: "posted", voucherId: voucher.id });
}

export const bankHandlers: Record<string, ObjectHandlers> = {
  "bank.account": {
    actions: {
      async import(ctx, account, file) {
        if (!file) throw new UserError("@SYS:Required");
        await importStatement(ctx.data, account, file.data);
      },
    },
  },
  "bank.statement": {
    actions: {
      async match(ctx, st) {
        await autoMatch(ctx.data, String(st.id));
      },
      async post(ctx, st) {
        await postStatement(ctx.data, ctx.companyId, st);
      },
      async createJournal(ctx, st) {
        await journalFromStatement(ctx.data, st, ctx.t);
      },
      async recheck(ctx, st) {
        await checkStatementChain(ctx.data, st, ctx.t);
      },
    },
  },
  "bank.statementLine": {
    /** nejvýš jedna vazba; druh párování podle vyplněné vazby; směr musí sedět */
    async beforeSave(ctx, data): Promise<ValidationErrors | void> {
      await assertDraft(ctx.data, data.statementId);
      const filled = ["customerTransId", "vendorTransId", "customerAdvanceId", "vendorAdvanceId", "offsetAccountId"].filter((f) => data[f]);
      if (filled.length > 1) return { [filled[1]]: "@BANK:OneMatch" };
      const amount = toCents(data.amount);
      if (data.customerTransId && amount < zero) return { customerTransId: "@BANK:WrongDirection" };
      if (data.vendorTransId && amount > zero) return { vendorTransId: "@BANK:WrongDirection" };
      if (data.customerAdvanceId && amount < zero) return { customerAdvanceId: "@BANK:WrongDirection" };
      if (data.vendorAdvanceId && amount > zero) return { vendorAdvanceId: "@BANK:WrongDirection" };
      for (const [f, obj] of [["customerAdvanceId", "ar.advance"], ["vendorAdvanceId", "ap.advance"]] as const) {
        if (!data[f]) continue;
        const a = await ctx.data.get(obj, String(data[f]));
        if (!a || a.status === "settled" || a.status === "cancelled") throw new UserError("@BANK:AdvanceClosed", { doc: String(a?.advanceNum ?? "") });
      }
      for (const [f, obj] of [["customerTransId", "ar.trans"], ["vendorTransId", "ap.trans"]] as const) {
        if (!data[f]) continue;
        const t = await ctx.data.get(obj, String(data[f]));
        if (t?.closed) throw new UserError("@BANK:TransClosed", { doc: String(t.documentNum) });
      }
      data.matchKind = data.customerTransId
        ? "customer"
        : data.vendorTransId
          ? "vendor"
          : data.customerAdvanceId
            ? "customerAdvance"
            : data.vendorAdvanceId
              ? "vendorAdvance"
              : data.offsetAccountId
                ? "ledger"
                : "none";
    },
    async afterSave(ctx, data) {
      await recalcStatement(ctx.data, String(data.statementId));
    },
    beforeDelete: async (ctx, data) => {
      await assertDraft(ctx.data, data.statementId);
    },
    async afterDelete(ctx, data) {
      await recalcStatement(ctx.data, String(data.statementId));
    },
  },
};
