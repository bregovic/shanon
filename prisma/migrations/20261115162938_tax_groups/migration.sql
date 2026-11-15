-- AlterTable
ALTER TABLE "gl_account" ADD COLUMN     "item_tax_group_id" UUID;

-- AlterTable
ALTER TABLE "gl_journal_name" ADD COLUMN     "amounts_include_tax" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "gl_journal_line" ADD COLUMN     "item_tax_group_id" UUID,
ADD COLUMN     "tax_amount" DECIMAL(18,2),
ADD COLUMN     "tax_code_id" UUID,
ADD COLUMN     "tax_doc_num" VARCHAR(20),
ADD COLUMN     "tax_extra" DECIMAL(18,2),
ADD COLUMN     "tax_group_id" UUID;

-- AlterTable
ALTER TABLE "tax_code" ADD COLUMN     "deduct_line" VARCHAR(10),
ADD COLUMN     "kh_item_code" VARCHAR(4),
ADD COLUMN     "output_account_id" UUID;

-- AlterTable
ALTER TABLE "tax_trans" ADD COLUMN     "kh_item_code" VARCHAR(4),
ADD COLUMN     "kh_section" VARCHAR(4),
ADD COLUMN     "report_line" VARCHAR(10);

-- AlterTable
ALTER TABLE "tax_return" ADD COLUMN     "line_summary" TEXT;

-- AlterTable
ALTER TABLE "inv_item_group" ADD COLUMN     "item_tax_group_id" UUID;

-- AlterTable
ALTER TABLE "inv_item" ADD COLUMN     "item_tax_group_id" UUID;

-- AlterTable
ALTER TABLE "ar_group" ADD COLUMN     "tax_group_id" UUID;

-- AlterTable
ALTER TABLE "ar_customer" ADD COLUMN     "tax_group_id" UUID;

-- AlterTable
ALTER TABLE "ar_order" ADD COLUMN     "tax_group_id" UUID;

-- AlterTable
ALTER TABLE "ar_order_line" ADD COLUMN     "item_tax_group_id" UUID,
ADD COLUMN     "tax_group_id" UUID;

-- AlterTable
ALTER TABLE "ar_invoice" ADD COLUMN     "tax_group_id" UUID;

-- AlterTable
ALTER TABLE "ar_invoice_line" ADD COLUMN     "item_tax_group_id" UUID,
ADD COLUMN     "tax_group_id" UUID;

-- AlterTable
ALTER TABLE "ap_group" ADD COLUMN     "tax_group_id" UUID;

-- AlterTable
ALTER TABLE "ap_vendor" ADD COLUMN     "tax_group_id" UUID;

-- AlterTable
ALTER TABLE "ap_order" ADD COLUMN     "tax_group_id" UUID;

-- AlterTable
ALTER TABLE "ap_order_line" ADD COLUMN     "item_tax_group_id" UUID,
ADD COLUMN     "tax_group_id" UUID;

-- AlterTable
ALTER TABLE "ap_invoice" ADD COLUMN     "tax_group_id" UUID;

-- AlterTable
ALTER TABLE "ap_invoice_line" ADD COLUMN     "item_tax_group_id" UUID,
ADD COLUMN     "tax_group_id" UUID;

-- CreateTable
CREATE TABLE "tax_group" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(255),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "tax_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_item_group" (
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

    CONSTRAINT "tax_item_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_group_code" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "tax_group_id" UUID NOT NULL,
    "item_tax_group_id" UUID NOT NULL,
    "sales_code_id" UUID,
    "purchase_code_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "tax_group_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_group_tenant_id_company_id_idx" ON "tax_group"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_group_tenant_id_company_id_code_key" ON "tax_group"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "tax_item_group_tenant_id_company_id_idx" ON "tax_item_group"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_item_group_tenant_id_company_id_code_key" ON "tax_item_group"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "tax_group_code_tenant_id_company_id_idx" ON "tax_group_code"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "tax_group_code_tax_group_id_idx" ON "tax_group_code"("tax_group_id");

-- CreateIndex
CREATE INDEX "tax_group_code_item_tax_group_id_idx" ON "tax_group_code"("item_tax_group_id");

-- CreateIndex
CREATE INDEX "tax_group_code_sales_code_id_idx" ON "tax_group_code"("sales_code_id");

-- CreateIndex
CREATE INDEX "tax_group_code_purchase_code_id_idx" ON "tax_group_code"("purchase_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_group_code_tenant_id_company_id_tax_group_id_item_tax_g_key" ON "tax_group_code"("tenant_id", "company_id", "tax_group_id", "item_tax_group_id");

-- CreateIndex
CREATE INDEX "gl_account_item_tax_group_id_idx" ON "gl_account"("item_tax_group_id");

-- CreateIndex
CREATE INDEX "gl_journal_line_tax_code_id_idx" ON "gl_journal_line"("tax_code_id");

-- CreateIndex
CREATE INDEX "gl_journal_line_tax_group_id_idx" ON "gl_journal_line"("tax_group_id");

-- CreateIndex
CREATE INDEX "gl_journal_line_item_tax_group_id_idx" ON "gl_journal_line"("item_tax_group_id");

-- CreateIndex
CREATE INDEX "tax_code_output_account_id_idx" ON "tax_code"("output_account_id");

-- CreateIndex
CREATE INDEX "inv_item_group_item_tax_group_id_idx" ON "inv_item_group"("item_tax_group_id");

-- CreateIndex
CREATE INDEX "inv_item_item_tax_group_id_idx" ON "inv_item"("item_tax_group_id");

-- CreateIndex
CREATE INDEX "ar_group_tax_group_id_idx" ON "ar_group"("tax_group_id");

-- CreateIndex
CREATE INDEX "ar_customer_tax_group_id_idx" ON "ar_customer"("tax_group_id");

-- CreateIndex
CREATE INDEX "ar_order_tax_group_id_idx" ON "ar_order"("tax_group_id");

-- CreateIndex
CREATE INDEX "ar_order_line_tax_group_id_idx" ON "ar_order_line"("tax_group_id");

-- CreateIndex
CREATE INDEX "ar_order_line_item_tax_group_id_idx" ON "ar_order_line"("item_tax_group_id");

-- CreateIndex
CREATE INDEX "ar_invoice_tax_group_id_idx" ON "ar_invoice"("tax_group_id");

-- CreateIndex
CREATE INDEX "ar_invoice_line_tax_group_id_idx" ON "ar_invoice_line"("tax_group_id");

-- CreateIndex
CREATE INDEX "ar_invoice_line_item_tax_group_id_idx" ON "ar_invoice_line"("item_tax_group_id");

-- CreateIndex
CREATE INDEX "ap_group_tax_group_id_idx" ON "ap_group"("tax_group_id");

-- CreateIndex
CREATE INDEX "ap_vendor_tax_group_id_idx" ON "ap_vendor"("tax_group_id");

-- CreateIndex
CREATE INDEX "ap_order_tax_group_id_idx" ON "ap_order"("tax_group_id");

-- CreateIndex
CREATE INDEX "ap_order_line_tax_group_id_idx" ON "ap_order_line"("tax_group_id");

-- CreateIndex
CREATE INDEX "ap_order_line_item_tax_group_id_idx" ON "ap_order_line"("item_tax_group_id");

-- CreateIndex
CREATE INDEX "ap_invoice_tax_group_id_idx" ON "ap_invoice"("tax_group_id");

-- CreateIndex
CREATE INDEX "ap_invoice_line_tax_group_id_idx" ON "ap_invoice_line"("tax_group_id");

-- CreateIndex
CREATE INDEX "ap_invoice_line_item_tax_group_id_idx" ON "ap_invoice_line"("item_tax_group_id");

-- AddForeignKey
ALTER TABLE "gl_account" ADD CONSTRAINT "gl_account_item_tax_group_id_fkey" FOREIGN KEY ("item_tax_group_id") REFERENCES "tax_item_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_line" ADD CONSTRAINT "gl_journal_line_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_line" ADD CONSTRAINT "gl_journal_line_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_line" ADD CONSTRAINT "gl_journal_line_item_tax_group_id_fkey" FOREIGN KEY ("item_tax_group_id") REFERENCES "tax_item_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_code" ADD CONSTRAINT "tax_code_output_account_id_fkey" FOREIGN KEY ("output_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_group" ADD CONSTRAINT "tax_group_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_item_group" ADD CONSTRAINT "tax_item_group_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_group_code" ADD CONSTRAINT "tax_group_code_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_group_code" ADD CONSTRAINT "tax_group_code_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_group_code" ADD CONSTRAINT "tax_group_code_item_tax_group_id_fkey" FOREIGN KEY ("item_tax_group_id") REFERENCES "tax_item_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_group_code" ADD CONSTRAINT "tax_group_code_sales_code_id_fkey" FOREIGN KEY ("sales_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_group_code" ADD CONSTRAINT "tax_group_code_purchase_code_id_fkey" FOREIGN KEY ("purchase_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_item_group" ADD CONSTRAINT "inv_item_group_item_tax_group_id_fkey" FOREIGN KEY ("item_tax_group_id") REFERENCES "tax_item_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_item" ADD CONSTRAINT "inv_item_item_tax_group_id_fkey" FOREIGN KEY ("item_tax_group_id") REFERENCES "tax_item_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_group" ADD CONSTRAINT "ar_group_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_customer" ADD CONSTRAINT "ar_customer_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_order" ADD CONSTRAINT "ar_order_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_order_line" ADD CONSTRAINT "ar_order_line_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_order_line" ADD CONSTRAINT "ar_order_line_item_tax_group_id_fkey" FOREIGN KEY ("item_tax_group_id") REFERENCES "tax_item_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice" ADD CONSTRAINT "ar_invoice_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice_line" ADD CONSTRAINT "ar_invoice_line_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice_line" ADD CONSTRAINT "ar_invoice_line_item_tax_group_id_fkey" FOREIGN KEY ("item_tax_group_id") REFERENCES "tax_item_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_group" ADD CONSTRAINT "ap_group_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_vendor" ADD CONSTRAINT "ap_vendor_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_order" ADD CONSTRAINT "ap_order_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_order_line" ADD CONSTRAINT "ap_order_line_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_order_line" ADD CONSTRAINT "ap_order_line_item_tax_group_id_fkey" FOREIGN KEY ("item_tax_group_id") REFERENCES "tax_item_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice" ADD CONSTRAINT "ap_invoice_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice_line" ADD CONSTRAINT "ap_invoice_line_tax_group_id_fkey" FOREIGN KEY ("tax_group_id") REFERENCES "tax_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice_line" ADD CONSTRAINT "ap_invoice_line_item_tax_group_id_fkey" FOREIGN KEY ("item_tax_group_id") REFERENCES "tax_item_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
