/** Report Pokladní kniha: pohyby na účtu pokladny s průběžným zůstatkem. */
import { fromCents, toCents } from "@/core/money";
import type { RecordData } from "@/core/module";
import { defineReport } from "@/core/report";

const zero = BigInt(0);

export const cashBook = defineReport({
  id: "cashBook",
  label: "@CASH:CashBook",
  description: "@CASH:CashBookDesc",
  requires: ["cash.desk", "gl.trans"],
  params: [
    { name: "deskId", label: "@CASH:Desk", kind: "ref", refObject: "cash.desk" },
    { name: "dateFrom", label: "@GL:DateFrom", kind: "date", default: "$monthStart" },
    { name: "dateTo", label: "@GL:DateTo", kind: "date", default: "$today" },
  ],
  async run(data, p, { t }) {
    const desks = await data.find("cash.desk", {}, { take: 100, orderBy: { code: "asc" } });
    const desk = desks.find((d) => d.id === p.deskId) ?? desks[0];
    const columns = [
      { name: "date", label: "@SYS:Date", kind: "string" as const },
      { name: "doc", label: "@CASH:DocNum", kind: "string" as const },
      { name: "text", label: "@CASH:Text", kind: "string" as const },
      { name: "income", label: "@CASH:Income", kind: "amount" as const, total: true },
      { name: "expense", label: "@CASH:Expense", kind: "amount" as const, total: true },
      { name: "balance", label: "@CASH:Balance", kind: "amount" as const },
    ];
    if (!desk) return { columns, rows: [] };
    const from = String(p.dateFrom);
    const trans = await data.find("gl.trans", { accountId: desk.accountId, date: { lte: String(p.dateTo) } }, { take: 500000, orderBy: { date: "asc" } });
    let bal = zero;
    for (const tr of trans) if (String(tr.date) < from) bal += toCents(tr.amount);
    const rows: RecordData[] = [{ date: "", doc: "", text: t("@CASH:Opening"), income: null, expense: null, balance: fromCents(bal), _level: 1 }];
    const vouchers = new Map<string, RecordData | null>();
    for (const tr of trans) {
      if (String(tr.date) < from) continue;
      const amt = toCents(tr.amount);
      bal += amt;
      const vid = String(tr.voucherId);
      if (!vouchers.has(vid)) vouchers.set(vid, await data.get("gl.voucher", vid));
      const v = vouchers.get(vid);
      rows.push({
        date: String(tr.date),
        doc: String(v?.voucherNum ?? ""),
        text: String(tr.text ?? v?.description ?? ""),
        income: amt > zero ? fromCents(amt) : null,
        expense: amt < zero ? fromCents(-amt) : null,
        balance: fromCents(bal),
      });
    }
    rows.push({ date: "", doc: "", text: t("@CASH:Closing"), income: null, expense: null, balance: fromCents(bal), _level: 1 });
    return { columns, rows };
  },
});
