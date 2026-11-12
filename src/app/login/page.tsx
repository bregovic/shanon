import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { LoginForm } from "./login-form";

export const metadata = { title: "Přihlášení" };

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  const t = await getT("cs");
  return <LoginForm labels={{ email: t("@SYS:Email"), password: t("@SYS:Password"), submit: t("@SYS:SignIn") }} />;
}
