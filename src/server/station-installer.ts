/**
 * Instalace Shanonu pro Windows: Shanon-instalace.exe (src/station/setup) si podle odkazu
 * /api/station/installer/<párovací kód> stáhne instalační skript (program stanice s adresou, kódem a ikonou)
 * a spustí ho. Bez importů registru (volá ho obsluha modulu).
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

/** Instalátor pro Windows (stejný soubor pro všechny, podepisuje se jednou — scripts/build-station-exe.ps1). */
export function stationSetupExe(): Buffer {
  return readFileSync(join(process.cwd(), "src", "station", "Shanon-instalace.exe"));
}

/**
 * Instalační skript, který si instalátor stáhne: program stanice (src/station/stanice.ps1) s adresou Shanonu,
 * jednorázovým párovacím kódem a ikonou. UTF-8 s BOM (PowerShell 5.1 jinak čte češtinu špatně), řádky CRLF.
 */
export async function stationSetupScript(o: { url: string; code: string }): Promise<Buffer> {
  const agent = readFileSync(join(process.cwd(), "src", "station", "stanice.ps1"), "utf8").replace(/\r?\n/g, "\r\n");
  const ico = await shanonIco();
  const header = [`$SetupUrl = ${psQuote(o.url.replace(/\/$/, ""))}`, `$SetupPair = ${psQuote(o.code)}`, `$SetupIcon = ${psQuote(ico.toString("base64"))}`, ""].join("\r\n");
  return Buffer.concat([BOM, Buffer.from(header + agent, "utf8")]);
}
