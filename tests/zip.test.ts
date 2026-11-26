/** ZIP pro hromadné stažení: lokální hlavičky, deflate, UTF-8 názvy, stejné názvy s pořadím. */
import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { zipFiles } from "@/server/zip";

function entries(zip: Buffer) {
  const out: { name: string; data: string }[] = [];
  let o = 0;
  while (zip.readUInt32LE(o) === 0x04034b50) {
    const size = zip.readUInt32LE(o + 18);
    const nl = zip.readUInt16LE(o + 26);
    const name = zip.subarray(o + 30, o + 30 + nl).toString("utf8");
    const data = inflateRawSync(zip.subarray(o + 30 + nl, o + 30 + nl + size)).toString("utf8");
    out.push({ name, data });
    o += 30 + nl + size;
  }
  expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  return out;
}

describe("zip", () => {
  it("dva soubory, stejný název, diakritika", () => {
    const z = zipFiles([
      { name: "Faktura FV-1.isdoc", data: Buffer.from("<Invoice>1 – žluťoučký</Invoice>") },
      { name: "Faktura FV-1.isdoc", data: Buffer.from("<Invoice>2</Invoice>") },
    ]);
    expect(entries(z)).toEqual([
      { name: "Faktura FV-1.isdoc", data: "<Invoice>1 – žluťoučký</Invoice>" },
      { name: "Faktura FV-1 (2).isdoc", data: "<Invoice>2</Invoice>" },
    ]);
  });
});
