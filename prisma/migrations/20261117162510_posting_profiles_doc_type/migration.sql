-- AlterTable
ALTER TABLE "ar_parameters" ADD COLUMN     "posting_profile_id" UUID;

-- AlterTable
ALTER TABLE "ar_invoice" ADD COLUMN     "posting_profile_id" UUID;

-- AlterTable
ALTER TABLE "ar_trans" ADD COLUMN     "account_id" UUID;

-- AlterTable
ALTER TABLE "ap_parameters" ADD COLUMN     "donation_profile_id" UUID,
ADD COLUMN     "posting_profile_id" UUID;

-- AlterTable
ALTER TABLE "ap_invoice" ADD COLUMN     "doc_type" VARCHAR(40) NOT NULL DEFAULT 'invoice',
ADD COLUMN     "posting_profile_id" UUID;

-- účtenky (dřívější zaškrtávátko) → typ dokladu Účtenka
UPDATE "ap_invoice" SET "doc_type" = 'receipt' WHERE "receipt" = true;
ALTER TABLE "ap_invoice" DROP COLUMN "receipt";

-- AlterTable
ALTER TABLE "ap_trans" ADD COLUMN     "account_id" UUID;

-- CreateTable
CREATE TABLE "ar_posting_profile" (
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

    CONSTRAINT "ar_posting_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_posting_profile_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "account_code" VARCHAR(40) NOT NULL DEFAULT 'all',
    "customer_id" UUID,
    "group_id" UUID,
    "summary_account_id" UUID NOT NULL,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ar_posting_profile_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_posting_profile" (
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

    CONSTRAINT "ap_posting_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_posting_profile_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "account_code" VARCHAR(40) NOT NULL DEFAULT 'all',
    "vendor_id" UUID,
    "group_id" UUID,
    "summary_account_id" UUID NOT NULL,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ap_posting_profile_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ar_posting_profile_tenant_id_company_id_idx" ON "ar_posting_profile"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "ar_posting_profile_tenant_id_company_id_code_key" ON "ar_posting_profile"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "ar_posting_profile_line_tenant_id_company_id_idx" ON "ar_posting_profile_line"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ar_posting_profile_line_profile_id_idx" ON "ar_posting_profile_line"("profile_id");

-- CreateIndex
CREATE INDEX "ar_posting_profile_line_customer_id_idx" ON "ar_posting_profile_line"("customer_id");

-- CreateIndex
CREATE INDEX "ar_posting_profile_line_group_id_idx" ON "ar_posting_profile_line"("group_id");

-- CreateIndex
CREATE INDEX "ar_posting_profile_line_summary_account_id_idx" ON "ar_posting_profile_line"("summary_account_id");

-- CreateIndex
CREATE INDEX "ap_posting_profile_tenant_id_company_id_idx" ON "ap_posting_profile"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_posting_profile_tenant_id_company_id_code_key" ON "ap_posting_profile"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "ap_posting_profile_line_tenant_id_company_id_idx" ON "ap_posting_profile_line"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ap_posting_profile_line_profile_id_idx" ON "ap_posting_profile_line"("profile_id");

-- CreateIndex
CREATE INDEX "ap_posting_profile_line_vendor_id_idx" ON "ap_posting_profile_line"("vendor_id");

-- CreateIndex
CREATE INDEX "ap_posting_profile_line_group_id_idx" ON "ap_posting_profile_line"("group_id");

-- CreateIndex
CREATE INDEX "ap_posting_profile_line_summary_account_id_idx" ON "ap_posting_profile_line"("summary_account_id");

-- CreateIndex
CREATE INDEX "ar_parameters_posting_profile_id_idx" ON "ar_parameters"("posting_profile_id");

-- CreateIndex
CREATE INDEX "ar_invoice_posting_profile_id_idx" ON "ar_invoice"("posting_profile_id");

-- CreateIndex
CREATE INDEX "ar_trans_account_id_idx" ON "ar_trans"("account_id");

-- CreateIndex
CREATE INDEX "ap_parameters_posting_profile_id_idx" ON "ap_parameters"("posting_profile_id");

-- CreateIndex
CREATE INDEX "ap_parameters_donation_profile_id_idx" ON "ap_parameters"("donation_profile_id");

-- CreateIndex
CREATE INDEX "ap_invoice_posting_profile_id_idx" ON "ap_invoice"("posting_profile_id");

-- CreateIndex
CREATE INDEX "ap_trans_account_id_idx" ON "ap_trans"("account_id");

-- AddForeignKey
ALTER TABLE "ar_parameters" ADD CONSTRAINT "ar_parameters_posting_profile_id_fkey" FOREIGN KEY ("posting_profile_id") REFERENCES "ar_posting_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_posting_profile" ADD CONSTRAINT "ar_posting_profile_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_posting_profile_line" ADD CONSTRAINT "ar_posting_profile_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_posting_profile_line" ADD CONSTRAINT "ar_posting_profile_line_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "ar_posting_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_posting_profile_line" ADD CONSTRAINT "ar_posting_profile_line_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "ar_customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_posting_profile_line" ADD CONSTRAINT "ar_posting_profile_line_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "ar_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_posting_profile_line" ADD CONSTRAINT "ar_posting_profile_line_summary_account_id_fkey" FOREIGN KEY ("summary_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice" ADD CONSTRAINT "ar_invoice_posting_profile_id_fkey" FOREIGN KEY ("posting_profile_id") REFERENCES "ar_posting_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_trans" ADD CONSTRAINT "ar_trans_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_parameters" ADD CONSTRAINT "ap_parameters_posting_profile_id_fkey" FOREIGN KEY ("posting_profile_id") REFERENCES "ap_posting_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_parameters" ADD CONSTRAINT "ap_parameters_donation_profile_id_fkey" FOREIGN KEY ("donation_profile_id") REFERENCES "ap_posting_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_posting_profile" ADD CONSTRAINT "ap_posting_profile_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_posting_profile_line" ADD CONSTRAINT "ap_posting_profile_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_posting_profile_line" ADD CONSTRAINT "ap_posting_profile_line_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "ap_posting_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_posting_profile_line" ADD CONSTRAINT "ap_posting_profile_line_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "ap_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_posting_profile_line" ADD CONSTRAINT "ap_posting_profile_line_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "ap_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_posting_profile_line" ADD CONSTRAINT "ap_posting_profile_line_summary_account_id_fkey" FOREIGN KEY ("summary_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice" ADD CONSTRAINT "ap_invoice_posting_profile_id_fkey" FOREIGN KEY ("posting_profile_id") REFERENCES "ap_posting_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_trans" ADD CONSTRAINT "ap_trans_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
