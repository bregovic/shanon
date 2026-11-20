"use server";
/**
 * Akce aplikace Portál (vlastní přihlášení, ne relace Shanonu). Identitu a firmy ověřuje každá akce znovu
 * z cookie portálu (`portalIdentity`).
 */
import { cookies, headers } from "next/headers";
import { UserError } from "@/core/module";
import { getT } from "@/server/i18n";
import { employeeLogin, portalIdentity, portalLogout, requestVendorLink, savePortalPrefs, setEmployeePassword } from "@/server/portal-auth";
import { portalAgendas, type PortalAgendaInfo } from "@/server/portal-app";

type Result<T = undefined> = { ok: true; data: T } | { ok: false; message: string };

const ip = async () => {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
};

async function fail(e: unknown, tenantId?: string): Promise<{ ok: false; message: string }> {
  const t = await getT("cs", tenantId);
  if (e instanceof UserError) return { ok: false, message: t(e.label, e.params) };
  console.error("portál", e);
  return { ok: false, message: t("@INT:AppError") };
}

/** zapamatovat organizaci (start aplikace /p/start otevře naposledy použitou) */
async function rememberTenant(code: string) {
  (await cookies()).set("shanon_portal_tenant", code, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 365 * 86_400 });
}

export async function portalEmployeeLoginAction(tenant: string, personalNum: string, password: string): Promise<Result> {
  try {
    await employeeLogin(tenant, personalNum, password, await ip());
    await rememberTenant(tenant);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

/** Odkaz do e-mailu — odpověď je vždy stejná (neprozradí, jestli adresu známe). */
export async function portalVendorLinkAction(tenant: string, email: string): Promise<Result> {
  try {
    if (!(await requestVendorLink(tenant, email, await ip()))) return { ok: false, message: (await getT("cs"))("@SYS:InvalidEmail") };
    await rememberTenant(tenant);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function portalSetPasswordAction(tenant: string, token: string, password: string): Promise<Result> {
  try {
    await setEmployeePassword(tenant, token, password);
    await rememberTenant(tenant);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function portalLogoutAction(): Promise<void> {
  await portalLogout();
}

/** Agendy vybrané firmy (a zapamatovat si ji). */
export async function portalAgendasAction(tenant: string, companyId: string): Promise<Result<{ agendas: PortalAgendaInfo[]; maxFileMb: number; maxFiles: number }>> {
  const id = await portalIdentity(tenant);
  if (!id) return { ok: false, message: (await getT("cs"))("@INT:AppSignedOut") };
  try {
    const a = await portalAgendas(id, companyId);
    if (!a) return { ok: false, message: (await getT("cs", id.tenantId))("@INT:AppNoCompany") };
    await savePortalPrefs(id.accountId, { ...id.prefs, companyId });
    return { ok: true, data: a };
  } catch (e) {
    return fail(e, id.tenantId);
  }
}

export async function portalRememberAgendaAction(tenant: string, companyId: string, agenda: string): Promise<void> {
  const id = await portalIdentity(tenant);
  if (id) await savePortalPrefs(id.accountId, { companyId, agenda: agenda.slice(0, 20) });
}
