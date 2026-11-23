/**
 * Osobní instalátor tiskové stanice: jeden soubor .cmd (dvojklik ve Windows). Obsahuje program stanice
 * (src/station/stanice.ps1) s adresou Shanonu, jednorázovým párovacím kódem a ikonou (base64 za značkou
 * ::PAYLOAD::) — rozbalí ho do dočasného souboru a spustí PowerShell. Bez importů registru (volá ho obsluha modulu).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Ikona Windows (.ico) z loga — obrázky PNG 16–256 px (Windows Vista a novější). */
export async function shanonIco(): Promise<Buffer> {
  const src = readFileSync(join(process.cwd(), "public", "icons", "shanon-512.png"));
  const sizes = [16, 32, 48, 256];
  const pngs = await Promise.all(sizes.map((s) => sharp(src).resize(s, s).png().toBuffer()));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(s >= 256 ? 0 : s, e);
    head.writeUInt8(s >= 256 ? 0 : s, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(pngs[i].length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([head, ...pngs]);
}

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** text do .cmd jen v ASCII (konzole cmd má jinou kódovou stránku) */
const ascii = (s: string) => s.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/[&|<>^%"]/g, "");

export async function stationInstaller(o: { url: string; code: string; deviceName: string }): Promise<string> {
  const agent = readFileSync(join(process.cwd(), "src", "station", "stanice.ps1"), "utf8").replace(/\r?\n/g, "\r\n");
  const ico = await shanonIco();
  const header = [`$SetupUrl = ${psQuote(o.url.replace(/\/$/, ""))}`, `$SetupPair = ${psQuote(o.code)}`, `$SetupIcon = ${psQuote(ico.toString("base64"))}`, ""].join("\r\n");
  const payload = Buffer.concat([BOM, Buffer.from(header + agent, "utf8")]).toString("base64");
  return [
    "@echo off",
    "title Shanon - instalace",
    `echo Instaluji Shanon pro Windows (${ascii(o.deviceName)})...`,
    'set "SHANON_SETUP=%~f0"',
    'set "SHANON_PS=%TEMP%\\shanon-pokladna-setup.ps1"',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:SHANON_SETUP);$i=$t.LastIndexOf('::PAYLOAD::');[IO.File]::WriteAllBytes($env:SHANON_PS,[Convert]::FromBase64String($t.Substring($i+11).Trim()))"`,
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%SHANON_PS%"',
    'del "%SHANON_PS%" >nul 2>&1',
    "exit /b",
    "::PAYLOAD::",
    payload,
    "",
  ].join("\r\n");
}
