-- AlterTable
ALTER TABLE "ar_customer" ADD COLUMN     "payment_method_id" UUID;

-- AlterTable
ALTER TABLE "ap_vendor" ADD COLUMN     "payment_method_id" UUID;

-- AlterTable
ALTER TABLE "bank_statement" ADD COLUMN     "check_message" VARCHAR(255),
ADD COLUMN     "check_status" VARCHAR(40),
ADD COLUMN     "journal_id" UUID;

-- CreateTable
CREATE TABLE "sys_transformation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "direction" VARCHAR(40) NOT NULL,
    "purpose" VARCHAR(40) NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sys_transformation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_payment_method" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(40) NOT NULL DEFAULT 'transfer',
    "bank_account_id" UUID,
    "transformation_id" UUID,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "bank_payment_method_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_payment_order" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_num" VARCHAR(20) NOT NULL,
    "payment_method_id" UUID NOT NULL,
    "bank_account_id" UUID,
    "payment_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_to" DATE,
    "description" VARCHAR(255),
    "total" DECIMAL(18,2),
    "status" VARCHAR(40) NOT NULL DEFAULT 'draft',
    "exported_at" DATE,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "bank_payment_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_payment_order_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "payment_order_id" UUID NOT NULL,
    "vendor_trans_id" UUID,
    "vendor_id" UUID NOT NULL,
    "document_num" VARCHAR(255),
    "due_date" DATE,
    "account_num" VARCHAR(40),
    "iban" VARCHAR(34),
    "bic" VARCHAR(11),
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_id" UUID,
    "vs" VARCHAR(10),
    "ks" VARCHAR(4),
    "ss" VARCHAR(10),
    "message" VARCHAR(140),
    "warning" VARCHAR(255),
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "bank_payment_order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_import_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "file_name" VARCHAR(255),
    "account_num" VARCHAR(255),
    "statement_num" VARCHAR(20),
    "date" DATE,
    "status" VARCHAR(40) NOT NULL,
    "message" VARCHAR(255),
    "statement_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "bank_import_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sys_transformation_tenant_id_idx" ON "sys_transformation"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_transformation_tenant_id_code_key" ON "sys_transformation"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "bank_payment_method_tenant_id_company_id_idx" ON "bank_payment_method"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "bank_payment_method_bank_account_id_idx" ON "bank_payment_method"("bank_account_id");

-- CreateIndex
CREATE INDEX "bank_payment_method_transformation_id_idx" ON "bank_payment_method"("transformation_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_payment_method_tenant_id_company_id_code_key" ON "bank_payment_method"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "bank_payment_order_tenant_id_company_id_idx" ON "bank_payment_order"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "bank_payment_order_payment_method_id_idx" ON "bank_payment_order"("payment_method_id");

-- CreateIndex
CREATE INDEX "bank_payment_order_bank_account_id_idx" ON "bank_payment_order"("bank_account_id");

-- CreateIndex
CREATE INDEX "bank_payment_order_line_tenant_id_company_id_idx" ON "bank_payment_order_line"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "bank_payment_order_line_payment_order_id_idx" ON "bank_payment_order_line"("payment_order_id");

-- CreateIndex
CREATE INDEX "bank_payment_order_line_vendor_trans_id_idx" ON "bank_payment_order_line"("vendor_trans_id");

-- CreateIndex
CREATE INDEX "bank_payment_order_line_vendor_id_idx" ON "bank_payment_order_line"("vendor_id");

-- CreateIndex
CREATE INDEX "bank_payment_order_line_currency_id_idx" ON "bank_payment_order_line"("currency_id");

-- CreateIndex
CREATE INDEX "bank_import_log_tenant_id_company_id_idx" ON "bank_import_log"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "bank_import_log_statement_id_idx" ON "bank_import_log"("statement_id");

-- CreateIndex
CREATE INDEX "ar_customer_payment_method_id_idx" ON "ar_customer"("payment_method_id");

-- CreateIndex
CREATE INDEX "ap_vendor_payment_method_id_idx" ON "ap_vendor"("payment_method_id");

-- CreateIndex
CREATE INDEX "bank_statement_journal_id_idx" ON "bank_statement"("journal_id");

-- AddForeignKey
ALTER TABLE "ar_customer" ADD CONSTRAINT "ar_customer_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "bank_payment_method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_vendor" ADD CONSTRAINT "ap_vendor_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "bank_payment_method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "gl_journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_payment_method" ADD CONSTRAINT "bank_payment_method_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_payment_method" ADD CONSTRAINT "bank_payment_method_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_payment_method" ADD CONSTRAINT "bank_payment_method_transformation_id_fkey" FOREIGN KEY ("transformation_id") REFERENCES "sys_transformation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_payment_order" ADD CONSTRAINT "bank_payment_order_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_payment_order" ADD CONSTRAINT "bank_payment_order_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "bank_payment_method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_payment_order" ADD CONSTRAINT "bank_payment_order_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_payment_order_line" ADD CONSTRAINT "bank_payment_order_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_payment_order_line" ADD CONSTRAINT "bank_payment_order_line_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "bank_payment_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_payment_order_line" ADD CONSTRAINT "bank_payment_order_line_vendor_trans_id_fkey" FOREIGN KEY ("vendor_trans_id") REFERENCES "ap_trans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_payment_order_line" ADD CONSTRAINT "bank_payment_order_line_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "ap_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_payment_order_line" ADD CONSTRAINT "bank_payment_order_line_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_import_log" ADD CONSTRAINT "bank_import_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_import_log" ADD CONSTRAINT "bank_import_log_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "bank_statement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
