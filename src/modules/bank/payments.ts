/**
 * Platební příkazy (deník plateb závazků) a deníky hlavní knihy z výpisů.
 *
 * Příkaz: Navrhnout úhrady (otevřené faktury dodavatelů splatné do data, které
 * ještě nejsou v jiném příkazu) → kontrola (účet, registr DPH: nespolehlivý
 * plátce, nezveřejněný účet — projde jen s Odsouhlaseno) → soubor pro banku
 * podle transformace platební metody (ABO, SEPA). Úhradu pak zaúčtuje výpis
 * (párování podle VS).
 *
 * Výpis: kontrola návaznosti (zůstatek, chybějící čísla) a Vytvořit deník HK
 * (banka proti odběrateli / dodavateli / účtu podle spárování; nespárované
 * řádky doplní účetní v deníku).
 */
import { fromCents, toCents } from "@/core/money";
import { UserError, type DataApi, type DownloadFile, type ObjectHandlers, type RecordData } from "@/core/module";
import { transformByCode } from "@/core/transform";
import { aboFile, sepaFile, type PayOrder } from "./payment-formats";

const zero = BigInt(0);
const remaining = (t: RecordData) => toCents(t.amountCur ?? t.amount) - toCents(t.paidAmount);

async function assertDraftOrder(data: DataApi, id: unknown) {
  const o = id ? await data.get("bank.paymentOrder", String(id)) : null;
  if (o && o.status !== "draft") throw new UserError("@GL:Locked");
  return o;
}

async function recalcOrder(data: DataApi, id: string) {
  const lines = await data.find("bank.paymentOrderLine", { paymentOrderId: id }, { take: 5000 });
  await data.update("bank.paymentOrder", id, { total: fromCents(lines.reduce((s, l) => s + toCents(l.amount), zero)) });
}

/** Výchozí údaje platby z otevřené položky a dodavatele + upozornění z registru DPH. */
async function fillLine(data: DataApi, d: RecordData, t: (r: string) => string) {
  if (d.vendorTransId) {
    const tr = await data.get("ap.trans", String(d.vendorTransId));
    if (tr) {
      d.vendorId ??= tr.vendorId;
      if (!d.amount) d.amount = fromCents(remaining(tr));
      d.vs ??= tr.vs ?? null;
      d.documentNum ??= tr.documentNum ?? null;
      d.dueDate = tr.dueDate ?? null;
      d.currencyId ??= tr.currencyId ?? null;
    }
  }
  const vend = d.vendorId ? await data.get("ap.vendor", String(d.vendorId)) : null;
  const subj = vend ? await data.get("gab.subject", String(vend.subjectId)) : null;
  if (vend && !d.accountNum && !d.iban && vend.bankAccountId) {
    const a = await data.get("gab.bankAccount", String(vend.bankAccountId));
    if (a) {
      d.accountNum = a.accountNum ?? null;
      d.iban = a.iban ?? null;
      d.bic ??= a.bic ?? null;
    }
  }
  // registr DPH: nespolehlivý plátce, účet mimo zveřejněné
  const warn: string[] = [];
  if (subj?.vatReliability === "unreliable") warn.push(t("@BANK:Unreliable"));
  if (subj && subj.vatReliability === "reliable" && (d.accountNum || d.iban)) {
    const accs = await data.find("gab.bankAccount", { subjectId: subj.id, published: true }, { take: 200 });
    const key = (x: unknown) => String(x ?? "").replace(/\s/g, "").toUpperCase();
    const ok = accs.some((a) => (d.accountNum && key(a.accountNum) === key(d.accountNum)) || (d.iban && key(a.iban) === key(d.iban)));
    if (accs.length && !ok) warn.push(t("@BANK:Unpublished"));
  }
  d.warning = warn.join(" · ") || null;
}

/** Návrh úhrad: otevřené faktury dodavatelů splatné do data, ještě v žádném příkazu. */
async function suggest(data: DataApi, o: RecordData, t: (r: string) => string) {
  const due = String(o.dueTo ?? o.paymentDate);
  const busy = new Set<string>();
  for (const other of await data.find("bank.paymentOrder", {}, { take: 1000 })) {
    if (other.status === "cancelled") continue;
    for (const l of await data.find("bank.paymentOrderLine", { paymentOrderId: other.id }, { take: 5000 })) if (l.vendorTransId) busy.add(String(l.vendorTransId));
  }
  const method = await data.get("bank.paymentMethod", String(o.paymentMethodId));
  for (const tr of await data.find("ap.trans", { kind: "invoice", closed: false }, { take: 5000, orderBy: { dueDate: "asc" } })) {
    if (busy.has(String(tr.id)) || remaining(tr) <= zero) continue;
    if (tr.dueDate && String(tr.dueDate) > due) continue;
    const vend = await data.get("ap.vendor", String(tr.vendorId));
    if (vend?.blocked) continue;
    // dodavatel s jinou platební metodou do příkazu nepatří
    if (vend?.paymentMethodId && method && vend.paymentMethodId !== method.id) continue;
    const line: RecordData = { paymentOrderId: o.id, vendorTransId: tr.id };
    await fillLine(data, line, t);
    await data.create("bank.paymentOrderLine", line);
  }
}

async function exportOrder(data: DataApi, o: RecordData, companyId: string | null): Promise<DownloadFile> {
  const method = await data.get("bank.paymentMethod", String(o.paymentMethodId));
  const tr = method?.transformationId ? await data.get("sys.transformation", String(method.transformationId)) : null;
  const def = transformByCode(tr?.code);
  if (!def || def.purpose !== "paymentOrder" || tr?.active === false) throw new UserError("@BANK:NoTransform");
  const acc = await data.get("bank.account", String(o.bankAccountId ?? method?.bankAccountId ?? ""));
  if (!acc || (!acc.accountNum && !acc.iban)) throw new UserError("@BANK:NoPayerAccount");
  const lines = await data.find("bank.paymentOrderLine", { paymentOrderId: o.id }, { take: 5000 });
  if (!lines.length) throw new UserError("@BANK:EmptyOrder");
  const missing = lines.find((l) => !l.accountNum && !l.iban);
  if (missing) throw new UserError("@BANK:NoPayeeAccount", { doc: String(missing.documentNum ?? "") });
  const blocked = lines.filter((l) => l.warning && !l.approved);
  if (blocked.length) throw new UserError("@BANK:Blocked", { docs: blocked.map((l) => String(l.documentNum ?? "?")).join(", ") });
  const org = (await data.find("org.entity", {}, { take: 1 }).catch(() => []))[0] as RecordData | undefined;
  const company = companyId ? await data.get("sys.company", companyId) : null;
  const cur = acc.currencyId ? await data.get("sys.currency", String(acc.currencyId)) : null;
  const order: PayOrder = {
    number: String(o.orderNum),
    date: String(o.paymentDate),
    companyName: String(org?.legalName ?? company?.name ?? ""),
    account: (acc.accountNum as string) ?? null,
    iban: (acc.iban as string) ?? null,
    bic: null,
    currency: String(cur?.code ?? "CZK"),
    lines: await Promise.all(
      lines.map(async (l) => {
        const vend = await data.get("ap.vendor", String(l.vendorId));
        const subj = vend ? await data.get("gab.subject", String(vend.subjectId)) : null;
        const c = l.currencyId ? await data.get("sys.currency", String(l.currencyId)) : null;
        return {
          accountNum: (l.accountNum as string) ?? null,
          iban: (l.iban as string) ?? null,
          bic: (l.bic as string) ?? null,
          name: String(subj?.name ?? ""),
          amount: String(l.amount),
          currency: String(c?.code ?? cur?.code ?? "CZK"),
          vs: (l.vs as string) ?? null,
          ks: (l.ks as string) ?? null,
          ss: (l.ss as string) ?? null,
          message: (l.message as string) ?? (l.documentNum as string) ?? null,
          endToEndId: String(l.vs || l.documentNum || ""),
        };
      }),
    ),
  };
  let text: string;
  try {
    text = def.code === "ABO" ? aboFile(order) : sepaFile(order);
  } catch (e) {
    throw new UserError("@BANK:NoPayeeAccount", { doc: e instanceof Error ? e.message : "" });
  }
  await data.update("bank.paymentOrder", String(o.id), { status: "exported", exportedAt: new Date().toISOString().slice(0, 10) });
  return { name: `${o.orderNum}.${def.ext}`, mime: def.mime ?? "text/plain", data: text };
}

// ---------------------------------------------------------------------------
// Výpisy: kontrola návaznosti a deník HK
// ---------------------------------------------------------------------------

/** Návaznost na předchozí výpis účtu (zůstatek) a chybějící čísla výpisů. */
export async function checkStatementChain(data: DataApi, st: RecordData, t: (r: string, p?: Record<string, string>) => string) {
  const all = (await data.find("bank.statement", { bankAccountId: st.bankAccountId }, { take: 5000 })) as RecordData[];
  const num = (x: RecordData) => Number(String(x.statementNum).replace(/\D/g, "")) || 0;
  const prev = all.filter((x) => x.id !== st.id && num(x) < num(st)).sort((a, b) => num(b) - num(a))[0];
  const msgs: string[] = [];
  let status = "ok";
  if (prev) {
    if (toCents(prev.closingBalance) !== toCents(st.openingBalance)) {
      msgs.push(t("@BANK:BalanceGap", { prev: String(prev.statementNum), closing: fromCents(toCents(prev.closingBalance)), opening: fromCents(toCents(st.openingBalance)) }));
      status = "error";
    }
    const gap: number[] = [];
    for (let n = num(prev) + 1; n < num(st) && gap.length < 20; n++) gap.push(n);
    if (gap.length) {
      msgs.push(t("@BANK:MissingStatements", { nums: gap.join(", ") }));
      if (status === "ok") status = "warning";
    }
  }
  await data.update("bank.statement", String(st.id), { checkStatus: status, checkMessage: msgs.join(" ").slice(0, 255) || null });
  return status;
}

/** Deník HK z výpisu: řádek = banka proti partnerovi / účtu podle spárování. */
export async function journalFromStatement(data: DataApi, st: RecordData, t: (r: string, p?: Record<string, string>) => string) {
  if (st.journalId || st.status === "posted") throw new UserError("@BANK:JournalExists", { num: String(st.statementNum) });
  const acc = await data.get("bank.account", String(st.bankAccountId));
  const [jn] = await data.find("gl.journalName", { journalType: "bank" }, { take: 1 });
  const j = await data.create("gl.journal", {
    journalNameId: jn?.id ?? null,
    date: st.date,
    description: `${acc?.code ?? ""} · ${st.statementNum}`.slice(0, 255),
  });
  for (const l of await data.find("bank.statementLine", { statementId: st.id }, { take: 5000, orderBy: { lineNum: "asc" } })) {
    const amt = toCents(l.amount);
    const base: RecordData = {
      journalId: j.id,
      date: l.date,
      accountType: "bank",
      bankAccountId: st.bankAccountId,
      text: [l.vs ? `VS ${l.vs}` : null, l.message].filter(Boolean).join(" · ").slice(0, 255) || null,
      vs: l.vs ?? null,
      debit: amt > zero ? fromCents(amt) : null,
      credit: amt < zero ? fromCents(-amt) : null,
    };
    if (l.matchKind === "customer" || l.matchKind === "customerAdvance") {
      const tr = l.customerTransId ? await data.get("ar.trans", String(l.customerTransId)) : null;
      const adv = l.customerAdvanceId ? await data.get("ar.advance", String(l.customerAdvanceId)) : null;
      Object.assign(base, { offsetType: "customer", offsetCustomerId: tr?.customerId ?? adv?.customerId ?? null });
    } else if (l.matchKind === "vendor" || l.matchKind === "vendorAdvance") {
      const tr = l.vendorTransId ? await data.get("ap.trans", String(l.vendorTransId)) : null;
      const adv = l.vendorAdvanceId ? await data.get("ap.advance", String(l.vendorAdvanceId)) : null;
      Object.assign(base, { offsetType: "vendor", offsetVendorId: tr?.vendorId ?? adv?.vendorId ?? null });
    } else if (l.matchKind === "ledger" && l.offsetAccountId) {
      Object.assign(base, { offsetType: "ledger", offsetAccountId: l.offsetAccountId });
    } else {
      // nespárované: protistranu doplní účetní v deníku
      Object.assign(base, { offsetType: "ledger", offsetAccountId: null });
    }
    await data.create("gl.journalLine", base);
  }
  await data.update("bank.statement", String(st.id), { journalId: j.id });
  void t;
}

export const paymentHandlers: Record<string, ObjectHandlers> = {
  "bank.paymentOrder": {
    async beforeSave(ctx, d) {
      if (d.paymentMethodId && !d.bankAccountId) {
        const m = await ctx.data.get("bank.paymentMethod", String(d.paymentMethodId));
        d.bankAccountId = m?.bankAccountId ?? null;
      }
    },
    actions: {
      async suggest(ctx, o) {
        await assertDraftOrder(ctx.data, o.id);
        await suggest(ctx.data, o, ctx.t);
        await recalcOrder(ctx.data, String(o.id));
      },
      async cancel(ctx, o) {
        await ctx.data.update("bank.paymentOrder", String(o.id), { status: "draft", exportedAt: null });
      },
    },
    downloads: {
      async export(ctx, o) {
        if (o.status !== "draft") throw new UserError("@GL:Locked");
        return exportOrder(ctx.data, o, ctx.companyId);
      },
    },
  },
  "bank.paymentOrderLine": {
    async beforeSave(ctx, d) {
      await assertDraftOrder(ctx.data, d.paymentOrderId);
      await fillLine(ctx.data, d, ctx.t);
    },
    async afterSave(ctx, d) {
      await recalcOrder(ctx.data, String(d.paymentOrderId));
    },
    beforeDelete: async (ctx, d) => void (await assertDraftOrder(ctx.data, d.paymentOrderId)),
    async afterDelete(ctx, d) {
      await recalcOrder(ctx.data, String(d.paymentOrderId));
    },
  },
  "sys.transformation": {
    beforeSave(_ctx, d) {
      const def = transformByCode(d.code);
      if (!def) return { code: "@SYS:TrUnknown" };
      d.direction = def.direction;
      d.purpose = def.purpose;
    },
  },
};
