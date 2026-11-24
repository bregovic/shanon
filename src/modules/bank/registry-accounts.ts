/**
 * Bankovní účty firmy zveřejněné v registru plátců DPH (daňový portál) → modul Banka.
 * Volá založení firmy z registru i akce Doplnit z ARES u organizace.
 */
import type { DataApi } from "@/core/module";
import { czIban } from "@/core/print";

/**
 * Zakládá jen chybějící účty (podle čísla účtu nebo IBAN), IBAN dopočítá; první účet na 221000,
 * další na vlastní analytiku 221001, 221002… Vrací počet založených.
 */
export async function createBankAccounts(api: DataApi, published: { accountNum: string | null; iban: string | null }[]): Promise<number> {
  const norm = (v: unknown) => String(v ?? "").replace(/\s/g, "").toUpperCase();
  const existing = await api.find("bank.account", {}, { take: 500 });
  const have = new Set(existing.flatMap((b) => [norm(b.accountNum), norm(b.iban)]).filter(Boolean));
  let n = 0;
  for (const a of published) {
    const iban = a.iban ?? czIban(a.accountNum);
    if (have.has(norm(a.accountNum)) || have.has(norm(iban))) continue;
    // účet hlavní knihy: 221000 pro první bankovní účet, další analytiky
    const used = new Set(existing.map((b) => String(b.glAccountId ?? "")));
    let gl: string | null = null;
    for (let i = 0; i < 100 && !gl; i++) {
      const num = `221${String(i).padStart(3, "0")}`;
      let [acc] = await api.find("gl.account", { accountNum: num }, { take: 1 });
      if (!acc) acc = await api.create("gl.account", { accountNum: num, name: `Bankovní účet ${a.accountNum ?? iban ?? ""}`.slice(0, 120), type: "asset", postingType: "bank", noManualEntry: true });
      if (!used.has(String(acc.id))) gl = String(acc.id);
    }
    if (!gl) break;
    const code = `BU${String(existing.length + 1).padStart(2, "0")}`;
    // první účet firmy je výchozí (QR platby, platební příkazy)
    const created = await api.create("bank.account", { code, name: `Běžný účet ${a.accountNum ?? iban ?? ""}`.slice(0, 120), accountNum: a.accountNum, iban, glAccountId: gl, ...(existing.length ? {} : { isDefault: true }) });
    // platební metody účtu: české číslo → ABO výchozí, k tomu SEPA
    for (const [mcode, def] of [["PREVOD", !!a.accountNum], ["SEPA", !a.accountNum]] as const) {
      const [m] = await api.find("bank.paymentMethod", { code: mcode }, { take: 1 });
      if (m) await api.create("bank.accountMethod", { bankAccountId: created.id, paymentMethodId: m.id, isDefault: def });
    }
    existing.push(created);
    have.add(norm(a.accountNum));
    have.add(norm(iban));
    n++;
  }
  return n;
}
