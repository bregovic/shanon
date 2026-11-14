import { notFound } from "next/navigation";
import { BankImportView } from "@/components/bank-import-view";
import { can } from "@/core/security";
import { requireSession } from "@/server/auth";
import { getT } from "@/server/i18n";
import { objectHref } from "@/server/ui";

export const metadata = { title: "Import výpisů" };

export default async function BankImportPage() {
  const s = await requireSession();
  if (!s.ctx.modules.has("bank") || !s.ctx.companyId || !can(s.ctx.perms, "bank.statement", "write")) notFound();
  const t = await getT(s.lang, s.ctx.tenantId);
  const k = (x: string) => t(`@BANK:${x}`);
  return (
    <BankImportView
      crumbs={[{ label: k("Module"), href: "/bank" }, { label: k("BulkImport") }]}
      logHref={objectHref("bank.importLog")}
      statementHref={objectHref("bank.statement", "__ID__")}
      statusLabels={{ imported: k("ImpImported"), warning: k("ImpWarning"), duplicate: k("ImpDuplicate"), error: k("ImpError") }}
      labels={{
        intro: k("BulkImportIntro"),
        files: k("Files"),
        upload: k("Upload"),
        log: k("ImportLog"),
        file: k("FileName"),
        company: t("@SYS:Company"),
        account: k("AccountNum"),
        statement: k("StatementNum"),
        status: k("Status"),
        message: k("CheckMessage"),
      }}
    />
  );
}
