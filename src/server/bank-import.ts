/**
 * Hromadný import výpisů (GPC): soubor může obsahovat víc výpisů různých
 * účtů. Každý výpis se přiřadí firmě a bankovnímu účtu podle čísla účtu
 * (jen firmy, které uživatel spravuje, jinak aktuální), zkontroluje se
 * (součty, duplicita, návaznost zůstatku, chybějící čísla) a zapíše do
 * protokolu Importované výpisy.
 */
import { fromCents } from "@/core/money";
import { UserError, type RecordData } from "@/core/module";
import { can } from "@/core/security";
import { autoMatch, gpcAccountKey, recalcStatement } from "@/modules/bank/handlers";
import { checkStatement, decodeGpc, parseGpc, type GpcStatement } from "@/modules/bank/gpc";
import { checkStatementChain } from "@/modules/bank/payments";
import type { AppSession } from "./auth";
import { inTenant } from "./data";

export interface BulkRow {
  company: string;
  account: string;
  statementNum: string;
  status: "imported" | "warning" | "duplicate" | "error";
  message: string | null;
  statementId: string | null;
}

export async function importStatementsBulk(s: AppSession, file: { name: string; data: Buffer }): Promise<BulkRow[]> {
  const companies = s.companies.filter((c) => c.id === s.ctx.companyId || s.superUser || s.adminCompanyIds.includes(c.id));
  if (!can(s.ctx.perms, "bank.statement", "write")) throw new UserError("@SYS:NoAccess");
  const ctxOf = (companyId: string) => ({ ...s.ctx, companyId });
  const log = (companyId: string, r: BulkRow, date: string | null) =>
    inTenant(ctxOf(companyId), (sess) =>
      sess.sys().api().create("bank.importLog", { fileName: file.name.slice(0, 200), accountNum: r.account, statementNum: r.statementNum, date, status: r.status, message: r.message?.slice(0, 255) ?? null, statementId: r.statementId }),
    );
  const t = (sess: { sys(): { eventCtx(o: string): { t: (r: string, p?: Record<string, string>) => string } } }) => sess.sys().eventCtx("bank.statement").t;

  let statements: GpcStatement[];
  try {
    statements = parseGpc(decodeGpc(file.data));
  } catch {
    statements = [];
  }
  if (!statements.length) {
    const msg = await inTenant(s.ctx, async (sess) => t(sess)("@BANK:ImportNoStatement"));
    const r: BulkRow = { company: "", account: "", statementNum: "", status: "error", message: msg, statementId: null };
    if (s.ctx.companyId) await log(s.ctx.companyId, r, null);
    return [r];
  }

  // bankovní účty všech spravovaných firem (klíč = číslo účtu jako v GPC)
  const accounts: { companyId: string; companyCode: string; acc: RecordData }[] = [];
  for (const c of companies) {
    const list = await inTenant(ctxOf(c.id), (sess) => sess.sys().api().find("bank.account", {}, { take: 500 }));
    for (const a of list) if (a.accountNum) accounts.push({ companyId: c.id, companyCode: c.code, acc: a });
  }

  const out: BulkRow[] = [];
  for (const st of statements) {
    const hit = accounts.find((x) => gpcAccountKey(String(x.acc.accountNum)) === st.account);
    if (!hit) {
      const msg = await inTenant(s.ctx, async (sess) => t(sess)("@BANK:NoAccountForStatement", { account: st.account }));
      const r: BulkRow = { company: "", account: st.account, statementNum: st.statementNum, status: "error", message: msg, statementId: null };
      if (s.ctx.companyId) await log(s.ctx.companyId, r, st.date);
      out.push(r);
      continue;
    }
    const row = await inTenant(ctxOf(hit.companyId), async (sess) => {
      const api = sess.sys().api();
      const tr = t(sess);
      const base = { company: hit.companyCode, account: String(hit.acc.accountNum), statementNum: st.statementNum };
      const problem = checkStatement(st);
      if (problem) return { ...base, status: "error" as const, message: tr("@BANK:ImportCheck", { num: st.statementNum, detail: problem }), statementId: null };
      const [dup] = await api.find("bank.statement", { bankAccountId: hit.acc.id, statementNum: st.statementNum }, { take: 1 });
      if (dup) return { ...base, status: "duplicate" as const, message: tr("@BANK:ImportDuplicate", { num: st.statementNum }), statementId: String(dup.id) };
      const created = await api.create("bank.statement", { bankAccountId: hit.acc.id, statementNum: st.statementNum, date: st.date, openingBalance: fromCents(st.opening) });
      for (const l of st.lines) {
        await api.create("bank.statementLine", {
          statementId: created.id,
          lineNum: l.lineNum,
          date: l.date,
          amount: fromCents(l.cents),
          vs: l.vs && /^\d{1,10}$/.test(l.vs) ? l.vs : null,
          counterAccount: l.counterAccount,
          message: l.message,
        });
      }
      await recalcStatement(api, String(created.id));
      await autoMatch(api, String(created.id));
      const fresh = (await api.get("bank.statement", String(created.id)))!;
      const status = await checkStatementChain(api, fresh, tr);
      const after = (await api.get("bank.statement", String(created.id)))!;
      return { ...base, status: status === "ok" ? ("imported" as const) : ("warning" as const), message: (after.checkMessage as string) ?? null, statementId: String(created.id) };
    });
    await log(hit.companyId, row, st.date);
    out.push(row);
  }
  return out;
}
