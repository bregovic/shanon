/**
 * Úložiště obsahu souborů. Výchozí ovladač drží data v databázi
 * (sys_file_blob, pod RLS tenanta). Další ovladač — vlastní bucket tenanta
 * (Cloudflare R2 / S3, konfigurace v sys_tenant.storage) — doplní stejné
 * rozhraní; DocuRef si pamatuje, kde jeho soubor leží (storage + storageKey).
 */
import type { Tx } from "./db";

export interface FileStorage {
  id: string;
  put(tx: Tx, tenantId: string, data: Buffer): Promise<string>;
  get(tx: Tx, tenantId: string, key: string): Promise<Buffer | null>;
  remove(tx: Tx, tenantId: string, key: string): Promise<void>;
}

export const dbStorage: FileStorage = {
  id: "db",
  async put(tx, tenantId, data) {
    const blob = await tx.sysFileBlob.create({ data: { tenantId, data: new Uint8Array(data) }, select: { id: true } });
    return blob.id;
  },
  async get(tx, tenantId, key) {
    const blob = await tx.sysFileBlob.findFirst({ where: { id: key, tenantId } });
    return blob ? Buffer.from(blob.data) : null;
  },
  async remove(tx, tenantId, key) {
    await tx.sysFileBlob.deleteMany({ where: { id: key, tenantId } });
  },
};

const drivers: Record<string, FileStorage> = { db: dbStorage };

export const storageFor = (id: string | null | undefined): FileStorage => drivers[id ?? "db"] ?? dbStorage;

/** Úložiště pro nové soubory tenanta (zatím vždy databáze). */
export const defaultStorage = (): FileStorage => dbStorage;
