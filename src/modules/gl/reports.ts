/**
 * Výkazy hlavní knihy: obratová předvaha, rozvaha, výsledovka.
 * Počítají se ze zápisů (gl.trans) v účetní měně; volitelně po syntetických
 * účtech a s filtrem podle finančních dimenzí.
 */
import { fromCents, toCents } from "@/core/money";
import type { DataApi, RecordData } from "@/core/module";
import { defineReport, type ReportParam } from "@/core/report";
import { DIM_SLOTS, activeDimensions, dimField } from "./dimensions";

const zero = BigInt(0);

const commonParams = (from: boolean): ReportParam[] => [
  ...(from ? [{ name: "dateFrom", label: "@GL:DateFrom", kind: "date" as const, default: "$yearStart" }] : []),
  { name: "dateTo", label: "@GL:DateTo", kind: "date", default: "$today" },
  { name: "bySynthetic", label: "@GL:BySynthetic", kind: "bool", default: false },
  ...DIM_SLOTS.map((n) => ({ name: dimField(n), label: `@GL:Dimension`, kind: "dimension" as const })),
];

interface Acc {
  key: string;
  name: string;
  type: string;
  cls: number;
  opening: bigint;
  debit: bigint;
  credit: bigint;
}

/** Zůstatky a obraty účtů za období (zápisy do dateTo, obraty od dateFrom). */
async function balances(data: DataApi, p: RecordData) {
  const accounts = await data.find("gl.account", {}, { take: 10000, orderBy: { accountNum: "asc" } });
  const byId = new Map(accounts.map((a) => [String(a.id), a]));
  const where: RecordData = { date: { lte: String(p.dateTo) } };
  // filtr dimenzí (jen vyplněné)
  for (const n of DIM_SLOTS) {
    const v = p[dimField(n)];
    if (v) where[dimField(n)] = String(v).trim().toUpperCase();
  }
  const trans = await data.find("gl.trans", where, { take: 500000 });
  const from = p.dateFrom ? String(p.dateFrom) : null;
  const synth = !!p.bySynthetic;
  const map = new Map<string, Acc>();
  for (const t of trans) {
    const a = byId.get(String(t.accountId));
    if (!a) continue;
    const key = synth ? String(a.synthetic ?? String(a.accountNum).slice(0, 3)) : String(a.accountNum);
    const row = map.get(key) ?? {
      key,
      name: synth ? (accounts.find((x) => String(x.accountNum) === `${key}000`)?.name as string) ?? String(a.name) : String(a.name),
      type: String(a.type),
      cls: Number(String(a.accountNum)[0]),
      opening: zero,
      debit: zero,
      credit: zero,
    };
    const amt = toCents(t.amount);
    if (from && String(t.date) < from) row.opening += amt;
    else if (amt > zero) row.debit += amt;
    else row.credit -= amt;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

const money = (c: bigint) => fromCents(c);

export const trialBalance = defineReport({
  id: "trialBalance",
  label: "@GL:TrialBalance",
  description: "@GL:TrialBalanceDesc",
  requires: ["gl.trans", "gl.account"],
  params: commonParams(true),
  async run(data, p) {
    const rows = (await balances(data, p)).map((a) => ({
      account: a.key,
      name: a.name,
      opening: money(a.opening),
      debit: money(a.debit),
      credit: money(a.credit),
      closing: money(a.opening + a.debit - a.credit),
    }));
    return {
      columns: [
        { name: "account", label: "@GL:Account", kind: "string" },
        { name: "name", label: "@SYS:Name", kind: "string" },
        { name: "opening", label: "@GL:Opening", kind: "amount", total: true },
        { name: "debit", label: "@GL:TurnoverDebit", kind: "amount", total: true },
        { name: "credit", label: "@GL:TurnoverCredit", kind: "amount", total: true },
        { name: "closing", label: "@GL:Closing", kind: "amount", total: true },
      ],
      rows,
    };
  },
});

/** Rozvaha: aktiva / pasiva (třídy 0–4) k datu; výsledek hospodaření = výnosy − náklady. */
export const balanceSheet = defineReport({
  id: "balanceSheet",
  label: "@GL:BalanceSheet",
  description: "@GL:BalanceSheetDesc",
  requires: ["gl.trans", "gl.account"],
  params: commonParams(false),
  async run(data, p, { t }) {
    const all = await balances(data, p);
    const bal = (a: Acc) => a.opening + a.debit - a.credit;
    const assets = all.filter((a) => a.cls <= 4 && a.type === "asset");
    const liab = all.filter((a) => a.cls <= 4 && a.type !== "asset");
    const profit = -all.filter((a) => a.cls === 5 || a.cls === 6).reduce((s, a) => s + bal(a), zero);
    const sum = (xs: Acc[], sign: bigint) => xs.reduce((s, a) => s + sign * bal(a), zero);
    const rows: RecordData[] = [
      { account: "", name: t("@GL:Assets"), amount: money(sum(assets, BigInt(1))), _level: 1 },
      ...assets.map((a) => ({ account: a.key, name: a.name, amount: money(bal(a)) })),
      { account: "", name: t("@GL:LiabilitiesEquity"), amount: money(sum(liab, BigInt(-1)) + profit), _level: 1 },
      ...liab.map((a) => ({ account: a.key, name: a.name, amount: money(-bal(a)) })),
      { account: "", name: t("@GL:ProfitCurrent"), amount: money(profit) },
    ];
    return {
      columns: [
        { name: "account", label: "@GL:Account", kind: "string" },
        { name: "name", label: "@SYS:Name", kind: "string" },
        { name: "amount", label: "@GL:BalanceAmount", kind: "amount" },
      ],
      rows,
    };
  },
});

/** Výsledovka: výnosy (6) a náklady (5) za období, výsledek hospodaření. */
export const incomeStatement = defineReport({
  id: "incomeStatement",
  label: "@GL:IncomeStatement",
  description: "@GL:IncomeStatementDesc",
  requires: ["gl.trans", "gl.account"],
  params: commonParams(true),
  async run(data, p, { t }) {
    const all = (await balances(data, p)).filter((a) => a.cls === 5 || a.cls === 6);
    const turnover = (a: Acc) => a.debit - a.credit; // jen obraty období
    const rev = all.filter((a) => a.cls === 6);
    const exp = all.filter((a) => a.cls === 5);
    const revSum = -rev.reduce((s, a) => s + turnover(a), zero);
    const expSum = exp.reduce((s, a) => s + turnover(a), zero);
    const rows: RecordData[] = [
      { account: "", name: t("@GL:Revenues"), amount: money(revSum), _level: 1 },
      ...rev.map((a) => ({ account: a.key, name: a.name, amount: money(-turnover(a)) })),
      { account: "", name: t("@GL:Expenses"), amount: money(expSum), _level: 1 },
      ...exp.map((a) => ({ account: a.key, name: a.name, amount: money(turnover(a)) })),
      { account: "", name: t("@GL:ProfitLoss"), amount: money(revSum - expSum), _level: 1 },
    ];
    return {
      columns: [
        { name: "account", label: "@GL:Account", kind: "string" },
        { name: "name", label: "@SYS:Name", kind: "string" },
        { name: "amount", label: "@SYS:Amount", kind: "amount" },
      ],
      rows,
    };
  },
});

export const glReports = [trialBalance, balanceSheet, incomeStatement];

/** Názvy aktivních dimenzí pro popisky parametrů. */
export { activeDimensions };
