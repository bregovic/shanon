/**
 * Pozvánka nového uživatele, reset hesla správcem a žádost „Nemůžu se přihlásit“.
 *
 * Odkaz nese jednorázový token; v databázi je jen jeho SHA-256 (`sys_user.invite_token_hash`) a platnost.
 * Nastavení hesla token spotřebuje, odhlásí ostatní relace a zruší zámek po neúspěšných pokusech.
 * Nový uživatel bez hesla dostane náhodné heslo, které nikdo nezná — přihlásí se až po nastavení svého.
 */
import { isEmail } from "@/core/edt";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Lang } from "@/core/labels";
import { UserError } from "@/core/module";
import { clearLoginLock, loginLockMinutes } from "./auth";
import { prisma, withTenant } from "./db";
import { getT } from "./i18n";
import { inviteMail, loginHelpMail, resetMail } from "./mail-templates";
import { envUrls, sendSystemMail, supportEmail, systemMailConfigured } from "./system-mail";

const INVITE_DAYS = 7;
const RESET_DAYS = 2;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** heslo, které nikdo nezná (uživatel bez hesla = jen přes pozvánku) */
export const unusablePasswordHash = () => bcrypt.hash(randomBytes(32).toString("base64url"), 12);

/**
 * Poslat pozvánku / odkaz na nové heslo. `inviter` = kdo posílá (jméno do textu, odpověď na e-mail jde jemu).
 * Vrací false, když systémová pošta není nastavená (odkaz je jen v logu serveru).
 */
export async function sendPasswordLink(
  tenantId: string,
  userId: string,
  kind: "invite" | "reset",
  inviter: { name: string; email: string },
  companyName: string,
): Promise<boolean> {
  const user = await prisma.sysUser.findFirst({ where: { id: userId, tenantId } });
  if (!user) throw new UserError("@SYS:NotFound");
  if (!user.active) throw new UserError("@SYS:UserInactive");
  // starší účty mohly projít volnější kontrolou — poštovní server by adresu odmítl
  if (!isEmail(user.email)) throw new UserError("@SYS:InvalidEmailFix", { email: user.email });
  const token = randomBytes(32).toString("base64url");
  const days = kind === "invite" ? INVITE_DAYS : RESET_DAYS;
  await prisma.sysUser.update({
    where: { id: user.id },
    data: { inviteTokenHash: sha(token), inviteExpiresAt: new Date(Date.now() + days * 86_400_000), ...(kind === "invite" ? { invitedAt: new Date() } : {}) },
  });
  const t = await getT((user.lang as Lang) || "cs", tenantId);
  const link = `${envUrls().self}/login/heslo?t=${token}`;
  const name = user.firstName || user.name;
  // názvy firem jsou jen do textu — chyba při jejich čtení pozvánku nezastaví (pak název organizace)
  const companies = await userCompanyNames(tenantId, user.id).catch((e) => {
    console.error("firmy uživatele do pozvánky", e);
    return [] as string[];
  });
  const mail =
    kind === "invite"
      ? inviteMail(t, { name, email: user.email, company: companies[0] ?? companyName, others: companies.slice(1), inviter: inviter.name, link, days })
      : resetMail(t, { name, email: user.email, inviter: inviter.name, link, days });
  try {
    return await sendSystemMail({ to: user.email, replyTo: inviter.email, ...mail });
  } catch (e) {
    console.error("systémová pošta", e);
    throw new UserError("@SYS:MailFailed", { error: String((e as Error).message ?? e).slice(0, 200) });
  }
}

/**
 * Firmy, do kterých má uživatel přístup — v pořadí přiřazení (pak podle kódu). Superuživatel přiřazení nemá
 * (vidí všechny firmy), u něj je seznam prázdný a pozvánka jmenuje organizaci.
 */
async function userCompanyNames(tenantId: string, userId: string): Promise<string[]> {
  // přiřazení čte správa uživatelů přímo (aplikační role k sys_user_company práva nemá), firmy v tenantovi
  const links = await prisma.sysUserCompany.findMany({ where: { tenantId, userId }, orderBy: { createdAt: "asc" } });
  if (!links.length) return [];
  return withTenant(tenantId, async (tx) => {
    const cos = await tx.sysCompany.findMany({ where: { tenantId, id: { in: links.map((l) => l.companyId) } }, select: { id: true, code: true, name: true } });
    const byId = new Map(cos.map((c) => [c.id, c]));
    return links
      .map((l, i) => ({ i, c: byId.get(l.companyId) }))
      .filter((x) => !!x.c)
      .sort((a, b) => a.i - b.i || a.c!.code.localeCompare(b.c!.code))
      .map((x) => x.c!.name);
  });
}

/** Uživatel podle tokenu z odkazu (platný, aktivní účet), jinak null. */
export async function userByToken(token: string) {
  if (!token || token.length < 20) return null;
  const user = await prisma.sysUser.findFirst({ where: { inviteTokenHash: sha(token) } });
  if (!user || !user.active || !user.inviteExpiresAt || user.inviteExpiresAt < new Date()) return null;
  return user;
}

/** Nastavit heslo z odkazu; vrací e-mail (pro přihlášení). */
export async function setPasswordByToken(token: string, password: string): Promise<string> {
  const user = await userByToken(token);
  if (!user) throw new UserError("@SYS:LinkInvalid");
  if (password.length < 10) throw new UserError("@SYS:PasswordTooShort");
  await prisma.$transaction([
    prisma.sysUser.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 12), passwordSetAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null } }),
    prisma.sysSession.deleteMany({ where: { userId: user.id } }),
  ]);
  clearLoginLock(user.email);
  return user.email;
}

// brzda proti zahlcení správce: z jedné adresy / pro jeden e-mail nejvýš 3 žádosti za hodinu (na instanci)
const helpHits = new Map<string, number[]>();
function tooMany(key: string) {
  const now = Date.now();
  const hits = (helpHits.get(key) ?? []).filter((x) => x > now - 3_600_000);
  hits.push(now);
  helpHits.set(key, hits);
  return hits.length > 3;
}

/**
 * „Nemůžu se přihlásit“: zpráva správci se stavem účtu (existuje / aktivní / pozvaný bez hesla / zamčený).
 * Žadateli se odpovídá vždy stejně — odpověď neprozradí, jestli účet existuje.
 */
export async function requestLoginHelp(email: string, message: string, ip: string): Promise<void> {
  const key = email.trim().toLowerCase();
  if (!isEmail(key)) throw new UserError("@SYS:InvalidEmail");
  if (tooMany(`ip:${ip}`) || tooMany(`mail:${key}`)) return;
  const user = await prisma.sysUser.findUnique({ where: { email: key }, include: { tenant: true } });
  const t = await getT("cs");
  const locked = loginLockMinutes(key);
  const account = !user
    ? t("@SYS:HelpAccNone")
    : [
        `${user.name} (${user.tenant.name})`,
        user.active ? t("@SYS:HelpAccActive") : t("@SYS:HelpAccInactive"),
        user.invitedAt && !user.passwordSetAt ? t("@SYS:HelpAccInvited") : null,
        locked ? t("@SYS:HelpAccLocked", { minutes: String(locked) }) : null,
      ]
        .filter(Boolean)
        .join(" · ");
  const when = new Date().toLocaleString("cs-CZ", { timeZone: "Europe/Prague" });
  const mail = loginHelpMail(t, { email: key, message: message.trim().slice(0, 2000), account, when });
  await sendSystemMail({ to: supportEmail(), replyTo: key, ...mail });
}

export { systemMailConfigured };
