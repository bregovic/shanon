/** Nastavení hesla z odkazu v pozvánce / resetu (bez přihlášení; /login* proxy pouští). */
import { getT } from "@/server/i18n";
import { userByToken } from "@/server/user-invite";
import { SetPasswordForm } from "./set-password-form";

export const metadata = { title: "Nastavení hesla" };

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t: token = "" } = await searchParams;
  const user = await userByToken(token);
  const t = await getT(user?.lang === "en" ? "en" : "cs");
  return (
    <SetPasswordForm
      token={token}
      email={user?.email ?? null}
      labels={{
        title: t("@SYS:SetPasswordTitle"),
        account: user ? t("@SYS:SetPasswordFor", { email: user.email }) : "",
        password: t("@SYS:NewPassword"),
        password2: t("@SYS:PasswordAgain"),
        hint: t("@SYS:PasswordHelp"),
        submit: t("@SYS:SetPasswordSubmit"),
        invalid: t("@SYS:LinkInvalid"),
        back: t("@SYS:BackToLogin"),
      }}
    />
  );
}
