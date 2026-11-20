-- AlterTable
ALTER TABLE "int_portal" ADD COLUMN     "app_employees" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "app_vendors" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "int_document" ADD COLUMN     "employee_id" UUID;

-- CreateTable
CREATE TABLE "sys_portal_account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "login" VARCHAR(254) NOT NULL,
    "password_hash" TEXT,
    "token_hash" VARCHAR(64),
    "token_expires" TIMESTAMP(3),
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "prefs" JSONB NOT NULL DEFAULT '{}',
    "invited_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_portal_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_portal_session" (
    "id" VARCHAR(64) NOT NULL,
    "account_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_portal_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "int_portal_contact" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(120),
    "vendor_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "invited_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "note" VARCHAR(255),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "int_portal_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employee" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "personal_num" VARCHAR(20) NOT NULL,
    "first_name" VARCHAR(120) NOT NULL,
    "last_name" VARCHAR(120) NOT NULL,
    "name" VARCHAR(120),
    "email" VARCHAR(254),
    "phone" VARCHAR(30),
    "position" VARCHAR(255),
    "valid_from" DATE,
    "valid_to" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "portal_access" BOOLEAN NOT NULL DEFAULT true,
    "vendor_id" UUID,
    "portal_invited_at" TIMESTAMP(3),
    "portal_last_login" TIMESTAMP(3),
    "note" TEXT,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "hr_employee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sys_portal_account_token_hash_idx" ON "sys_portal_account"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sys_portal_account_tenant_id_kind_login_key" ON "sys_portal_account"("tenant_id", "kind", "login");

-- CreateIndex
CREATE INDEX "sys_portal_session_account_id_idx" ON "sys_portal_session"("account_id");

-- CreateIndex
CREATE INDEX "int_portal_contact_tenant_id_company_id_idx" ON "int_portal_contact"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "int_portal_contact_vendor_id_idx" ON "int_portal_contact"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "int_portal_contact_tenant_id_company_id_email_key" ON "int_portal_contact"("tenant_id", "company_id", "email");

-- CreateIndex
CREATE INDEX "hr_employee_tenant_id_company_id_idx" ON "hr_employee"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "hr_employee_vendor_id_idx" ON "hr_employee"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employee_tenant_id_company_id_personal_num_key" ON "hr_employee"("tenant_id", "company_id", "personal_num");

-- CreateIndex
CREATE INDEX "int_document_employee_id_idx" ON "int_document"("employee_id");

-- AddForeignKey
ALTER TABLE "sys_portal_session" ADD CONSTRAINT "sys_portal_session_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "sys_portal_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_portal_contact" ADD CONSTRAINT "int_portal_contact_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_portal_contact" ADD CONSTRAINT "int_portal_contact_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "ap_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_document" ADD CONSTRAINT "int_document_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee" ADD CONSTRAINT "hr_employee_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee" ADD CONSTRAINT "hr_employee_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "ap_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
