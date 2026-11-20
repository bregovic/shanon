/**
 * Bankovní účet pro QR platby pokladny: vybraný na pokladně (`qrBankAccountId`), jinak výchozí účet firmy
 * v účetní měně (Banka → Bankovní účty), jinak první účet v účetní měně. QR tržba se účtuje na jeho
 * analytiku (účet hlavní knihy bankovního účtu) a stejný účet je protiúčtem úhrady z výpisu.
 */
import type { DataApi, RecordData } from "@/core/module";
import { accountingCurrencyId } from "@/modules/gl/posting";

export async function qrBankRecord(data: DataApi, reg: RecordData, valid: (a: RecordData) => boolean = () => true): Promise<RecordData | null> {
  try {
    if (reg.qrBankAccountId) {
      const own = await data.get("bank.account", String(reg.qrBankAccountId));
      if (own && valid(own)) return own;
    }
    const base = await accountingCurrencyId(data, data.companyId ?? null);
    const accs = (await data.find("bank.account", { blocked: false }, { take: 20, orderBy: { code: "asc" } })).filter((a) => valid(a) && (!a.currencyId || a.currencyId === base));
    return accs.find((a) => a.isDefault) ?? accs[0] ?? null;
  } catch {
    return null; // Banka není zapnutá
  }
}

/** Účet hlavní knihy QR plateb pokladny: analytika bankovního účtu pro QR, bez Banky účet plateb kartou. */
export async function qrGlAccount(data: DataApi, reg: RecordData): Promise<string> {
  const acc = await qrBankRecord(data, reg);
  return String(acc?.glAccountId || reg.cardAccountId);
}
