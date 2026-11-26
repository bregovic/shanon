/** Jednoduchý ZIP (deflate) pro hromadné stažení souborů – bez knihovny, názvy v UTF-8. */
import { crc32, deflateRawSync } from "node:zlib";

export function zipFiles(files: { name: string; data: Buffer }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const used = new Set<string>();
  for (const f of files) {
    // stejné názvy: (2), (3)…
    let name = f.name.replace(/[\/:*?"<>|]+/g, "_") || "soubor";
    for (let i = 2; used.has(name.toLowerCase()); i++) name = f.name.replace(/(\.[^.]+)?$/, ` (${i})$1`);
    used.add(name.toLowerCase());
    const nameBuf = Buffer.from(name, "utf8");
    const comp = deflateRawSync(f.data);
    const crc = crc32(f.data) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // UTF-8 názvy
    h.writeUInt16LE(8, 8); // deflate
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(comp.length, 18);
    h.writeUInt32LE(f.data.length, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    local.push(h, nameBuf, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
