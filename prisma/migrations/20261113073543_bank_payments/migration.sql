-- AlterTable
ALTER TABLE "ar_invoice" ADD COLUMN     "paid_amount" DECIMAL(18,2),
ADD COLUMN     "vs" VARCHAR(10);

-- AlterTable
ALTER TABLE "ar_trans" ADD COLUMN     "closed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kind" VARCHAR(40) NOT NULL DEFAULT 'invoice',
ADD COLUMN     "paid_amount" DECIMAL(18,2),
ADD COLUMN     "vs" VARCHAR(10);

-- AlterTable
ALTER TABLE "ap_invoice" ADD COLUMN     "paid_amount" DECIMAL(18,2),
ADD COLUMN     "vs" VARCHAR(10);

-- AlterTable
ALTER TABLE "ap_trans" ADD COLUMN     "closed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kind" VARCHAR(40) NOT NULL DEFAULT 'invoice',
ADD COLUMN     "paid_amount" DECIMAL(18,2),
ADD COLUMN     "vs" VARCHAR(10);

-- CreateTable
CREATE TABLE "bank_account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "account_num" VARCHAR(40),
    "iban" VARCHAR(34),
    "currency_id" UUID,
    "gl_account_id" UUID NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "bank_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "statement_num" VARCHAR(20) NOT NULL,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_balance" DECIMAL(18,2),
    "credit" DECIMAL(18,2),
    "debit" DECIMAL(18,2),
    "closing_balance" DECIMAL(18,2),
    "status" VARCHAR(40) NOT NULL DEFAULT 'draft',
    "voucher_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "bank_statement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "line_num" INTEGER,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "vs" VARCHAR(10),
    "counter_account" VARCHAR(255),
    "message" VARCHAR(140),
    "match_kind" VARCHAR(40) DEFAULT 'none',
    "customer_trans_id" UUID,
    "vendor_trans_id" UUID,
    "offset_account_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "bank_statement_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_account_tenant_id_company_id_idx" ON "bank_account"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "bank_account_currency_id_idx" ON "bank_account"("currency_id");

-- CreateIndex
CREATE INDEX "bank_account_gl_account_id_idx" ON "bank_account"("gl_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_account_tenant_id_company_id_code_key" ON "bank_account"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "bank_statement_tenant_id_company_id_idx" ON "bank_statement"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "bank_statement_bank_account_id_idx" ON "bank_statement"("bank_account_id");

-- CreateIndex
CREATE INDEX "bank_statement_voucher_id_idx" ON "bank_statement"("voucher_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_tenant_id_company_id_bank_account_id_stateme_key" ON "bank_statement"("tenant_id", "company_id", "bank_account_id", "statement_num");

-- CreateIndex
CREATE INDEX "bank_statement_line_tenant_id_company_id_idx" ON "bank_statement_line"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "bank_statement_line_statement_id_idx" ON "bank_statement_line"("statement_id");

-- CreateIndex
CREATE INDEX "bank_statement_line_customer_trans_id_idx" ON "bank_statement_line"("customer_trans_id");

-- CreateIndex
CREATE INDEX "bank_statement_line_vendor_trans_id_idx" ON "bank_statement_line"("vendor_trans_id");

-- CreateIndex
CREATE INDEX "bank_statement_line_offset_account_id_idx" ON "bank_statement_line"("offset_account_id");

-- AddForeignKey
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "gl_voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "bank_statement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_customer_trans_id_fkey" FOREIGN KEY ("customer_trans_id") REFERENCES "ar_trans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_vendor_trans_id_fkey" FOREIGN KEY ("vendor_trans_id") REFERENCES "ap_trans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_offset_account_id_fkey" FOREIGN KEY ("offset_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
