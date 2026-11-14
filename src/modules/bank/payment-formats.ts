/**
 * Soubory platebních příkazů: ABO (KPC) pro české banky a SEPA pain.001.001.03.
 * Vstup je hotový příkaz (řádky s účtem příjemce, částkou, symboly).
 */
import { czIban } from "@/core/print";
import { toCents } from "@/core/money";

export interface PayOrderLine {
  accountNum: string | null;
  iban: string | null;
  bic: string | null;
  name: string;
  amount: string;
  currency: string;
  vs: string | null;
  ks: string | null;
  ss: string | null;
  message: string | null;
  endToEndId: string;
}

export interface PayOrder {
  number: string;
  date: string; // RRRR-MM-DD splatnost
  companyName: string;
  account: string | null; // náš účet předčíslí-číslo/kód
  iban: string | null;
  bic: string | null;
  currency: string;
  lines: PayOrderLine[];
}

const ddmmyy = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}`;
const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, " ");

/** "19-123456789/0100" → { acc: "19-123456789", bank: "0100" } */
function splitAccount(a: string | null): { acc: string; bank: string } | null {
  const m = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/.exec(String(a ?? "").replace(/\s/g, ""));
  if (!m) return null;
  return { acc: `${m[1] ? `${Number(m[1])}-` : ""}${m[2].replace(/^0+(?=\d)/, "")}`, bank: m[3] };
}

/**
 * ABO (KPC) — hromadný tuzemský příkaz k úhradě:
 *   UHL1 hlavička, 1 = účetní soubor (1501 = úhrady), 2 = skupina (účet plátce,
 *   součet, splatnost), položky (účet příjemce, částka v haléřích, VS, banka+KS, SS,
 *   AV: zpráva), 3 + = konec skupiny, 5 + = konec souboru. Řádky CRLF.
 */
export function aboFile(o: PayOrder): string {
  const payer = splitAccount(o.account);
  if (!payer) throw new Error("payer account");
  const lines: string[] = [];
  const total = o.lines.reduce((s, l) => s + toCents(l.amount), BigInt(0));
  const name = ascii(o.companyName).slice(0, 20).padEnd(20, " ");
  lines.push(`UHL1${ddmmyy(o.date)}${name}0000000000001999000000000000`);
  lines.push(`1 1501 ${o.number.replace(/\D/g, "").slice(-3).padStart(3, "0")}000 ${payer.bank}`);
  lines.push(`2 ${payer.acc} ${total.toString()} ${ddmmyy(o.date)}`);
  for (const l of o.lines) {
    const p = splitAccount(l.accountNum);
    if (!p) throw new Error(`account ${l.accountNum}`);
    const vs = (l.vs ?? "").replace(/\D/g, "").slice(0, 10) || "0";
    const ks = (l.ks ?? "").replace(/\D/g, "").slice(0, 4).padStart(4, "0");
    const ss = (l.ss ?? "").replace(/\D/g, "").slice(0, 10) || "0";
    const av = l.message ? ` AV:${ascii(l.message).slice(0, 35)}` : "";
    lines.push(`${p.acc} ${toCents(l.amount).toString()} ${vs} ${p.bank}${ks} ${ss}${av}`);
  }
  lines.push("3 +");
  lines.push("5 +");
  return lines.join("\r\n") + "\r\n";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const sepaText = (s: string, n: number) => esc(ascii(s).replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, " ").slice(0, n));

/** SEPA Credit Transfer pain.001.001.03 (jedna dávka, splatnost = datum příkazu). */
export function sepaFile(o: PayOrder, created = new Date()): string {
  const debtorIban = o.iban || czIban(o.account);
  if (!debtorIban) throw new Error("payer iban");
  const total = o.lines.reduce((s, l) => s + toCents(l.amount), BigInt(0));
  const amt = (c: bigint) => `${c / BigInt(100)}.${(c % BigInt(100)).toString().padStart(2, "0")}`;
  const msgId = `${o.number}-${created.getTime()}`.slice(0, 35);
  const tx = o.lines
    .map((l) => {
      const iban = l.iban || czIban(l.accountNum);
      if (!iban) throw new Error(`iban ${l.accountNum}`);
      const ref = [l.vs ? `/VS/${l.vs}` : "", l.ks ? `/KS/${l.ks}` : "", l.ss ? `/SS/${l.ss}` : ""].join("");
      return `      <CdtTrfTxInf>
        <PmtId><EndToEndId>${sepaText(l.endToEndId || "NOTPROVIDED", 35)}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="${l.currency}">${amt(toCents(l.amount))}</InstdAmt></Amt>${l.bic ? `\n        <CdtrAgt><FinInstnId><BIC>${esc(l.bic)}</BIC></FinInstnId></CdtrAgt>` : ""}
        <Cdtr><Nm>${sepaText(l.name, 70)}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${iban}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>${sepaText(`${ref}${ref && l.message ? " " : ""}${l.message ?? ""}`.trim() || o.number, 140)}</Ustrd></RmtInf>
      </CdtTrfTxInf>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${sepaText(msgId, 35)}</MsgId>
      <CreDtTm>${created.toISOString().slice(0, 19)}</CreDtTm>
      <NbOfTxs>${o.lines.length}</NbOfTxs>
      <CtrlSum>${amt(total)}</CtrlSum>
      <InitgPty><Nm>${sepaText(o.companyName, 70)}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${sepaText(o.number, 35)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>${o.lines.length}</NbOfTxs>
      <CtrlSum>${amt(total)}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt>${o.date}</ReqdExctnDt>
      <Dbtr><Nm>${sepaText(o.companyName, 70)}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${debtorIban}</IBAN></Id></DbtrAcct>
      <DbtrAgt><FinInstnId>${o.bic ? `<BIC>${esc(o.bic)}</BIC>` : "<Othr><Id>NOTPROVIDED</Id></Othr>"}</FinInstnId></DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${tx}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}
