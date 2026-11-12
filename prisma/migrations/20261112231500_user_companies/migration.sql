-- Uživatelé po firmách: role se přiřazují v rámci firmy (sys_user_company)

-- AlterTable
ALTER TABLE "sys_user" DROP COLUMN "role_ids";

-- CreateTable
CREATE TABLE "sys_user_company" (
    "user_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "admin" BOOLEAN NOT NULL DEFAULT false,
    "role_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_user_company_pkey" PRIMARY KEY ("user_id","company_id")
);

-- CreateIndex
CREATE INDEX "sys_user_company_tenant_id_company_id_idx" ON "sys_user_company"("tenant_id", "company_id");

-- AddForeignKey
ALTER TABLE "sys_user_company" ADD CONSTRAINT "sys_user_company_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
