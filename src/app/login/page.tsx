import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { LoginForm } from "./login-form";

export const metadata = { title: "Přihlášení" };

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  const t = await getT("cs");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-bold text-accent-fg">S</div>
          <span className="text-lg font-semibold">Shanon</span>
        </div>
        <LoginForm labels={{ email: t("@SYS:Email"), password: t("@SYS:Password"), submit: t("@SYS:SignIn") }} />
      </div>
    </main>
  );
}
