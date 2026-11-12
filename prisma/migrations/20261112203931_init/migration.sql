-- CreateTable
CREATE TABLE "sys_tenant" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "storage" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_user" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'user',
    "lang" VARCHAR(5) NOT NULL DEFAULT 'cs',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_session" (
    "id" VARCHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "company_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_tenant_module" (
    "tenant_id" UUID NOT NULL,
    "module_id" VARCHAR(40) NOT NULL,
    "enabled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_tenant_module_pkey" PRIMARY KEY ("tenant_id","module_id")
);

-- CreateTable
CREATE TABLE "sys_tenant_extension" (
    "tenant_id" UUID NOT NULL,
    "extension_id" VARCHAR(60) NOT NULL,
    "enabled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_tenant_extension_pkey" PRIMARY KEY ("tenant_id","extension_id")
);

-- CreateTable
CREATE TABLE "sys_label_override" (
    "tenant_id" UUID NOT NULL,
    "lang" VARCHAR(5) NOT NULL,
    "label_id" VARCHAR(80) NOT NULL,
    "text" VARCHAR(255) NOT NULL,

    CONSTRAINT "sys_label_override_pkey" PRIMARY KEY ("tenant_id","lang","label_id")
);

-- CreateTable
CREATE TABLE "sys_audit" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "object_id" VARCHAR(60) NOT NULL,
    "record_id" UUID NOT NULL,
    "action" VARCHAR(10) NOT NULL,
    "user_id" UUID,
    "changes" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_company" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "reg_no" VARCHAR(12),
    "vat_id" VARCHAR(16),
    "vat_payer" BOOLEAN NOT NULL DEFAULT true,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CZK',
    "country" VARCHAR(2) NOT NULL DEFAULT 'CZ',
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sys_company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_number_seq" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "format" VARCHAR(40) NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sys_number_seq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gab_subject" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" VARCHAR(40) NOT NULL DEFAULT 'organization',
    "reg_no" VARCHAR(12),
    "vat_id" VARCHAR(16),
    "email" VARCHAR(254),
    "phone" VARCHAR(30),
    "country" VARCHAR(2) DEFAULT 'CZ',
    "notes" TEXT,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gab_subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gab_address" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL DEFAULT 'registered',
    "street" VARCHAR(120),
    "city" VARCHAR(80) NOT NULL,
    "zip_code" VARCHAR(10),
    "country" VARCHAR(2) NOT NULL DEFAULT 'CZ',
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gab_address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gab_contact" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL DEFAULT 'email',
    "value" VARCHAR(254) NOT NULL,
    "description" VARCHAR(255),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gab_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "account_num" VARCHAR(10) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gl_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_cost_center" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gl_cost_center_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_voucher" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "voucher_num" VARCHAR(30) NOT NULL,
    "date" DATE NOT NULL,
    "description" VARCHAR(255),
    "source_object" VARCHAR(255),
    "source_id" VARCHAR(255),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gl_voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_trans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "account_id" UUID NOT NULL,
    "cost_center_id" UUID,
    "amount" DECIMAL(18,2) NOT NULL,
    "text" VARCHAR(255),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gl_trans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_journal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "journal_num" VARCHAR(30) NOT NULL,
    "date" DATE NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'draft',
    "voucher_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gl_journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_journal_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "cost_center_id" UUID,
    "debit" DECIMAL(18,2),
    "credit" DECIMAL(18,2),
    "text" VARCHAR(255),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gl_journal_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_code" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "rate" DECIMAL(7,4) NOT NULL,
    "direction" VARCHAR(40) NOT NULL,
    "reverse_charge" BOOLEAN NOT NULL DEFAULT false,
    "account_id" UUID NOT NULL,
    "report_line" VARCHAR(10),
    "kh_section" VARCHAR(4),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "tax_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sys_tenant_code_key" ON "sys_tenant"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sys_user_email_key" ON "sys_user"("email");

-- CreateIndex
CREATE INDEX "sys_user_tenant_id_idx" ON "sys_user"("tenant_id");

-- CreateIndex
CREATE INDEX "sys_session_user_id_idx" ON "sys_session"("user_id");

-- CreateIndex
CREATE INDEX "sys_audit_tenant_id_object_id_record_id_idx" ON "sys_audit"("tenant_id", "object_id", "record_id");

-- CreateIndex
CREATE INDEX "sys_company_tenant_id_idx" ON "sys_company"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_company_tenant_id_code_key" ON "sys_company"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "sys_number_seq_tenant_id_company_id_idx" ON "sys_number_seq"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_number_seq_tenant_id_company_id_code_key" ON "sys_number_seq"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "gab_subject_tenant_id_idx" ON "gab_subject"("tenant_id");

-- CreateIndex
CREATE INDEX "gab_address_tenant_id_idx" ON "gab_address"("tenant_id");

-- CreateIndex
CREATE INDEX "gab_address_subject_id_idx" ON "gab_address"("subject_id");

-- CreateIndex
CREATE INDEX "gab_contact_tenant_id_idx" ON "gab_contact"("tenant_id");

-- CreateIndex
CREATE INDEX "gab_contact_subject_id_idx" ON "gab_contact"("subject_id");

-- CreateIndex
CREATE INDEX "gl_account_tenant_id_company_id_idx" ON "gl_account"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "gl_account_tenant_id_company_id_account_num_key" ON "gl_account"("tenant_id", "company_id", "account_num");

-- CreateIndex
CREATE INDEX "gl_cost_center_tenant_id_company_id_idx" ON "gl_cost_center"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "gl_cost_center_tenant_id_company_id_code_key" ON "gl_cost_center"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "gl_voucher_tenant_id_company_id_idx" ON "gl_voucher"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "gl_voucher_tenant_id_company_id_voucher_num_key" ON "gl_voucher"("tenant_id", "company_id", "voucher_num");

-- CreateIndex
CREATE INDEX "gl_trans_tenant_id_company_id_idx" ON "gl_trans"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "gl_trans_voucher_id_idx" ON "gl_trans"("voucher_id");

-- CreateIndex
CREATE INDEX "gl_trans_account_id_idx" ON "gl_trans"("account_id");

-- CreateIndex
CREATE INDEX "gl_trans_cost_center_id_idx" ON "gl_trans"("cost_center_id");

-- CreateIndex
CREATE INDEX "gl_journal_tenant_id_company_id_idx" ON "gl_journal"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "gl_journal_voucher_id_idx" ON "gl_journal"("voucher_id");

-- CreateIndex
CREATE INDEX "gl_journal_line_tenant_id_company_id_idx" ON "gl_journal_line"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "gl_journal_line_journal_id_idx" ON "gl_journal_line"("journal_id");

-- CreateIndex
CREATE INDEX "gl_journal_line_account_id_idx" ON "gl_journal_line"("account_id");

-- CreateIndex
CREATE INDEX "gl_journal_line_cost_center_id_idx" ON "gl_journal_line"("cost_center_id");

-- CreateIndex
CREATE INDEX "tax_code_tenant_id_company_id_idx" ON "tax_code"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "tax_code_account_id_idx" ON "tax_code"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_code_tenant_id_company_id_code_key" ON "tax_code"("tenant_id", "company_id", "code");

-- AddForeignKey
ALTER TABLE "sys_user" ADD CONSTRAINT "sys_user_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "sys_tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_session" ADD CONSTRAINT "sys_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_tenant_module" ADD CONSTRAINT "sys_tenant_module_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "sys_tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_tenant_extension" ADD CONSTRAINT "sys_tenant_extension_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "sys_tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_label_override" ADD CONSTRAINT "sys_label_override_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "sys_tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_number_seq" ADD CONSTRAINT "sys_number_seq_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gab_address" ADD CONSTRAINT "gab_address_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "gab_subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gab_contact" ADD CONSTRAINT "gab_contact_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "gab_subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_account" ADD CONSTRAINT "gl_account_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_cost_center" ADD CONSTRAINT "gl_cost_center_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_voucher" ADD CONSTRAINT "gl_voucher_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_trans" ADD CONSTRAINT "gl_trans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_trans" ADD CONSTRAINT "gl_trans_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "gl_voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_trans" ADD CONSTRAINT "gl_trans_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_trans" ADD CONSTRAINT "gl_trans_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "gl_cost_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal" ADD CONSTRAINT "gl_journal_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal" ADD CONSTRAINT "gl_journal_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "gl_voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_line" ADD CONSTRAINT "gl_journal_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_line" ADD CONSTRAINT "gl_journal_line_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "gl_journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_line" ADD CONSTRAINT "gl_journal_line_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_line" ADD CONSTRAINT "gl_journal_line_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "gl_cost_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_code" ADD CONSTRAINT "tax_code_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_code" ADD CONSTRAINT "tax_code_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
