/**
 * Zámek pokladny čtyřmístným PINem (pos.register.pin, šifrovaně). Odemčení
 * platí pro uživatele a pokladnu (cookie s otiskem), Zamknout ho zruší —
 * směna zůstává otevřená, uzávěrka není potřeba.
 */
import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import type { RecordData } from "@/core/module";
import { revealSecret } from "./secrets";

const cookieName = (registerId: string) => `pos_unlock_${registerId.replace(/[^a-f0-9-]/gi, "")}`;
const token = (userId: string, registerId: string, pin: string) => createHash("sha256").update(`${userId}|${registerId}|${pin}|shanon-pos`).digest("hex");

/** PIN pokladny (null = pokladna bez zámku). */
export const registerPin = (reg: RecordData): string | null => {
  const pin = revealSecret(reg.pin);
  return pin && /^\d{4}$/.test(pin) ? pin : null;
};

export async function isUnlocked(userId: string, reg: RecordData): Promise<boolean> {
  const pin = registerPin(reg);
  if (!pin) return true;
  const v = (await cookies()).get(cookieName(String(reg.id)))?.value;
  return v === token(userId, String(reg.id), pin);
}

// brzda hádání PINu (na instanci): 5 chyb → minuta pauza
const tries = new Map<string, { n: number; until: number }>();

export async function unlock(userId: string, reg: RecordData, pin: string): Promise<"ok" | "wrong" | "wait"> {
  const key = `${userId}|${reg.id}`;
  const t = tries.get(key);
  if (t && t.n >= 5 && t.until > Date.now()) return "wait";
  const real = registerPin(reg);
  if (!real || pin !== real) {
    tries.set(key, { n: (t && t.until > Date.now() ? t.n : 0) + 1, until: Date.now() + 60_000 });
    return "wrong";
  }
  tries.delete(key);
  (await cookies()).set(cookieName(String(reg.id)), token(userId, String(reg.id), real), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 16 * 3600,
  });
  return "ok";
}

export async function lock(registerId: string) {
  (await cookies()).delete(cookieName(registerId));
}
