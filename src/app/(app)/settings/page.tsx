/** Moje nastavení — každý uživatel jen sám sobě (pod kolečkem v hlavičce). */
import { UserSettings } from "@/components/user-settings";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { getT } from "@/server/i18n";

export const metadata = { title: "Moje nastavení" };

const KEYS = [
  "UserSettings", "Profile", "Language", "ChangePassword", "CurrentPassword", "NewPassword", "RepeatPassword", "PasswordRules",
  "PasswordChanged", "PosPin", "PosPinHelp", "PosPinSet", "PosPinNone", "Notifications", "NotifyDailySummary", "NotifyOverdue",
  "NotifyIntegration", "NotifyInfo", "NotifyEmail", "Saved", "Save", "Name", "Email", "FirstName", "LastName", "InstallApp", "InstallAppHelp", "InstallAppIos", "InstallAppDone", "DefaultCompany", "DefaultCompanyHelp", "DefaultCompanyFirst"];

export default async function SettingsPage() {
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  const u = await prisma.sysUser.findUniqueOrThrow({ where: { id: s.user.id }, select: { name: true, firstName: true, lastName: true, email: true, lang: true, posPinHash: true, notify: true, defaultCompanyId: true } });
  return (
    <UserSettings
      crumbs={[{ label: t("@SYS:UserSettings") }]}
      user={{ firstName: u.firstName, lastName: u.lastName || (u.firstName ? "" : u.name), email: u.email, lang: u.lang, hasPin: !!u.posPinHash, notify: (u.notify ?? {}) as Record<string, boolean>, defaultCompanyId: u.defaultCompanyId ?? "" }}
      companies={s.companies.map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }))}
      L={Object.fromEntries(KEYS.map((k) => [k, t(`@SYS:${k}`)]))}
    />
  );
}
