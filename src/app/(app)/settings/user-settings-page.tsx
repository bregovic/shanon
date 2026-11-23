/** Můj profil a Nastavení uživatele — každý jen sám sobě (iniciály / ozubené kolo v hlavičce). */
import { UserSettings } from "@/components/user-settings";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { getT } from "@/server/i18n";
import { can } from "@/core/security";


const KEYS = [
  "UserSettings", "Profile", "Language", "ChangePassword", "CurrentPassword", "NewPassword", "RepeatPassword", "PasswordRules",
  "PasswordChanged", "PosPin", "PosPinHelp", "PosPinSet", "PosPinNone", "Notifications", "NotifyDailySummary", "NotifyOverdue",
  "NotifyIntegration", "NotifyInfo", "NotifyEmail", "Saved", "Save", "Name", "Email", "FirstName", "LastName", "InstallApp", "InstallAppHelp", "InstallAppIos", "InstallAppDone", "DefaultCompany", "DefaultCompanyHelp", "DefaultCompanyFirst", "Preferences", "StationApp", "StationAppInstall", "StationAppInstalled"];

/** Nastavení (ozubené kolo) a Můj profil (iniciály) — jedna komponenta, jiné karty. */
export async function userSettingsPage(section: "profile" | "settings") {
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  const u = await prisma.sysUser.findUniqueOrThrow({ where: { id: s.user.id }, select: { name: true, firstName: true, lastName: true, email: true, lang: true, posPinHash: true, notify: true, defaultCompanyId: true } });
  return (
    <UserSettings
      section={section}
      crumbs={[{ label: t(section === "profile" ? "@SYS:UserSettings" : "@SYS:Settings") }]}
      user={{ firstName: u.firstName, lastName: u.lastName || (u.firstName ? "" : u.name), email: u.email, lang: u.lang, hasPin: !!u.posPinHash, notify: (u.notify ?? {}) as Record<string, boolean>, defaultCompanyId: u.defaultCompanyId ?? "" }}
      canDevices={s.ctx.modules.has("int") && can(s.ctx.perms, "int.device", "write")}
      companies={s.companies.map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }))}
      L={Object.fromEntries(KEYS.map((k) => [k, t(`@SYS:${k}`)]))}
    />
  );
}
