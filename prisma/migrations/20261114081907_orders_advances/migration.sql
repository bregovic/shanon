-- AlterTable
ALTER TABLE "ar_group" ADD COLUMN     "advance_account_id" UUID;

-- AlterTable
ALTER TABLE "ar_invoice" ADD COLUMN     "advance_amount" DECIMAL(18,2),
ADD COLUMN     "advance_id" UUID,
ADD COLUMN     "order_id" UUID;

-- AlterTable
ALTER TABLE "ar_trans" ADD COLUMN     "advance_id" UUID;

-- AlterTable
ALTER TABLE "ap_group" ADD COLUMN     "advance_account_id" UUID;

-- AlterTable
ALTER TABLE "ap_invoice" ADD COLUMN     "advance_amount" DECIMAL(18,2),
ADD COLUMN     "advance_id" UUID,
ADD COLUMN     "order_id" UUID,
ALTER COLUMN "external_num" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ap_trans" ADD COLUMN     "advance_id" UUID;

-- AlterTable
ALTER TABLE "bank_statement_line" ADD COLUMN     "customer_advance_id" UUID,
ADD COLUMN     "vendor_advance_id" UUID;

-- CreateTable
CREATE TABLE "ar_order" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_num" VARCHAR(20) NOT NULL,
    "external_ref" VARCHAR(20),
    "customer_id" UUID NOT NULL,
    "order_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivery_date" DATE,
    "currency_id" UUID,
    "description" VARCHAR(255),
    "amount_net" DECIMAL(18,2),
    "tax_amount" DECIMAL(18,2),
    "amount_gross" DECIMAL(18,2),
    "status" VARCHAR(40) NOT NULL DEFAULT 'open',
    "invoice_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ar_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_order_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "item_id" UUID,
    "description" VARCHAR(255),
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unit_id" UUID,
    "unit_price" DECIMAL(18,2),
    "revenue_account_id" UUID,
    "tax_code_id" UUID,
    "dim1" VARCHAR(20),
    "dim2" VARCHAR(20),
    "dim3" VARCHAR(20),
    "dim4" VARCHAR(20),
    "dim5" VARCHAR(20),
    "dim6" VARCHAR(20),
    "amount_net" DECIMAL(18,2),
    "tax_amount" DECIMAL(18,2),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ar_order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_advance" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "advance_num" VARCHAR(20) NOT NULL,
    "customer_id" UUID NOT NULL,
    "order_id" UUID,
    "issue_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" DATE,
    "currency_id" UUID,
    "vs" VARCHAR(10),
    "description" VARCHAR(255),
    "amount" DECIMAL(18,2) NOT NULL,
    "paid_amount" DECIMAL(18,2),
    "settled_amount" DECIMAL(18,2),
    "status" VARCHAR(40) NOT NULL DEFAULT 'open',
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ar_advance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_order" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_num" VARCHAR(20) NOT NULL,
    "external_ref" VARCHAR(20),
    "vendor_id" UUID NOT NULL,
    "order_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivery_date" DATE,
    "currency_id" UUID,
    "description" VARCHAR(255),
    "amount_net" DECIMAL(18,2),
    "tax_amount" DECIMAL(18,2),
    "amount_gross" DECIMAL(18,2),
    "status" VARCHAR(40) NOT NULL DEFAULT 'open',
    "invoice_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ap_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_order_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "item_id" UUID,
    "description" VARCHAR(255),
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unit_id" UUID,
    "unit_price" DECIMAL(18,2),
    "expense_account_id" UUID,
    "tax_code_id" UUID,
    "dim1" VARCHAR(20),
    "dim2" VARCHAR(20),
    "dim3" VARCHAR(20),
    "dim4" VARCHAR(20),
    "dim5" VARCHAR(20),
    "dim6" VARCHAR(20),
    "amount_net" DECIMAL(18,2),
    "tax_amount" DECIMAL(18,2),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ap_order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_advance" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "advance_num" VARCHAR(20) NOT NULL,
    "external_num" VARCHAR(20),
    "vendor_id" UUID NOT NULL,
    "order_id" UUID,
    "issue_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" DATE,
    "currency_id" UUID,
    "vs" VARCHAR(10),
    "description" VARCHAR(255),
    "amount" DECIMAL(18,2) NOT NULL,
    "paid_amount" DECIMAL(18,2),
    "settled_amount" DECIMAL(18,2),
    "status" VARCHAR(40) NOT NULL DEFAULT 'open',
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ap_advance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ar_order_tenant_id_company_id_idx" ON "ar_order"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ar_order_customer_id_idx" ON "ar_order"("customer_id");

-- CreateIndex
CREATE INDEX "ar_order_currency_id_idx" ON "ar_order"("currency_id");

-- CreateIndex
CREATE INDEX "ar_order_invoice_id_idx" ON "ar_order"("invoice_id");

-- CreateIndex
CREATE INDEX "ar_order_line_tenant_id_company_id_idx" ON "ar_order_line"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ar_order_line_order_id_idx" ON "ar_order_line"("order_id");

-- CreateIndex
CREATE INDEX "ar_order_line_item_id_idx" ON "ar_order_line"("item_id");

-- CreateIndex
CREATE INDEX "ar_order_line_unit_id_idx" ON "ar_order_line"("unit_id");

-- CreateIndex
CREATE INDEX "ar_order_line_revenue_account_id_idx" ON "ar_order_line"("revenue_account_id");

-- CreateIndex
CREATE INDEX "ar_order_line_tax_code_id_idx" ON "ar_order_line"("tax_code_id");

-- CreateIndex
CREATE INDEX "ar_advance_tenant_id_company_id_idx" ON "ar_advance"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ar_advance_customer_id_idx" ON "ar_advance"("customer_id");

-- CreateIndex
CREATE INDEX "ar_advance_order_id_idx" ON "ar_advance"("order_id");

-- CreateIndex
CREATE INDEX "ar_advance_currency_id_idx" ON "ar_advance"("currency_id");

-- CreateIndex
CREATE INDEX "ap_order_tenant_id_company_id_idx" ON "ap_order"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ap_order_vendor_id_idx" ON "ap_order"("vendor_id");

-- CreateIndex
CREATE INDEX "ap_order_currency_id_idx" ON "ap_order"("currency_id");

-- CreateIndex
CREATE INDEX "ap_order_invoice_id_idx" ON "ap_order"("invoice_id");

-- CreateIndex
CREATE INDEX "ap_order_line_tenant_id_company_id_idx" ON "ap_order_line"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ap_order_line_order_id_idx" ON "ap_order_line"("order_id");

-- CreateIndex
CREATE INDEX "ap_order_line_item_id_idx" ON "ap_order_line"("item_id");

-- CreateIndex
CREATE INDEX "ap_order_line_unit_id_idx" ON "ap_order_line"("unit_id");

-- CreateIndex
CREATE INDEX "ap_order_line_expense_account_id_idx" ON "ap_order_line"("expense_account_id");

-- CreateIndex
CREATE INDEX "ap_order_line_tax_code_id_idx" ON "ap_order_line"("tax_code_id");

-- CreateIndex
CREATE INDEX "ap_advance_tenant_id_company_id_idx" ON "ap_advance"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ap_advance_vendor_id_idx" ON "ap_advance"("vendor_id");

-- CreateIndex
CREATE INDEX "ap_advance_order_id_idx" ON "ap_advance"("order_id");

-- CreateIndex
CREATE INDEX "ap_advance_currency_id_idx" ON "ap_advance"("currency_id");

-- CreateIndex
CREATE INDEX "ar_group_advance_account_id_idx" ON "ar_group"("advance_account_id");

-- CreateIndex
CREATE INDEX "ar_invoice_order_id_idx" ON "ar_invoice"("order_id");

-- CreateIndex
CREATE INDEX "ar_invoice_advance_id_idx" ON "ar_invoice"("advance_id");

-- CreateIndex
CREATE INDEX "ar_trans_advance_id_idx" ON "ar_trans"("advance_id");

-- CreateIndex
CREATE INDEX "ap_group_advance_account_id_idx" ON "ap_group"("advance_account_id");

-- CreateIndex
CREATE INDEX "ap_invoice_order_id_idx" ON "ap_invoice"("order_id");

-- CreateIndex
CREATE INDEX "ap_invoice_advance_id_idx" ON "ap_invoice"("advance_id");

-- CreateIndex
CREATE INDEX "ap_trans_advance_id_idx" ON "ap_trans"("advance_id");

-- CreateIndex
CREATE INDEX "bank_statement_line_customer_advance_id_idx" ON "bank_statement_line"("customer_advance_id");

-- CreateIndex
CREATE INDEX "bank_statement_line_vendor_advance_id_idx" ON "bank_statement_line"("vendor_advance_id");

-- AddForeignKey
ALTER TABLE "ar_group" ADD CONSTRAINT "ar_group_advance_account_id_fkey" FOREIGN KEY ("advance_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_order" ADD CONSTRAINT "ar_order_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_order" ADD CONSTRAINT "ar_order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "ar_customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_order" ADD CONSTRAINT "ar_order_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_order" ADD CONSTRAINT "ar_order_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ar_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_order_line" ADD CONSTRAINT "ar_order_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_order_line" ADD CONSTRAINT "ar_order_line_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ar_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_order_line" ADD CONSTRAINT "ar_order_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inv_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_order_line" ADD CONSTRAINT "ar_order_line_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "inv_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_order_line" ADD CONSTRAINT "ar_order_line_revenue_account_id_fkey" FOREIGN KEY ("revenue_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_order_line" ADD CONSTRAINT "ar_order_line_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice" ADD CONSTRAINT "ar_invoice_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ar_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice" ADD CONSTRAINT "ar_invoice_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "ar_advance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_advance" ADD CONSTRAINT "ar_advance_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_advance" ADD CONSTRAINT "ar_advance_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "ar_customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_advance" ADD CONSTRAINT "ar_advance_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ar_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_advance" ADD CONSTRAINT "ar_advance_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_trans" ADD CONSTRAINT "ar_trans_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "ar_advance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_group" ADD CONSTRAINT "ap_group_advance_account_id_fkey" FOREIGN KEY ("advance_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_order" ADD CONSTRAINT "ap_order_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_order" ADD CONSTRAINT "ap_order_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "ap_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_order" ADD CONSTRAINT "ap_order_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_order" ADD CONSTRAINT "ap_order_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ap_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_order_line" ADD CONSTRAINT "ap_order_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_order_line" ADD CONSTRAINT "ap_order_line_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ap_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_order_line" ADD CONSTRAINT "ap_order_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inv_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_order_line" ADD CONSTRAINT "ap_order_line_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "inv_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_order_line" ADD CONSTRAINT "ap_order_line_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_order_line" ADD CONSTRAINT "ap_order_line_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice" ADD CONSTRAINT "ap_invoice_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ap_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice" ADD CONSTRAINT "ap_invoice_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "ap_advance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_advance" ADD CONSTRAINT "ap_advance_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_advance" ADD CONSTRAINT "ap_advance_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "ap_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_advance" ADD CONSTRAINT "ap_advance_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ap_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_advance" ADD CONSTRAINT "ap_advance_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_trans" ADD CONSTRAINT "ap_trans_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "ap_advance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_customer_advance_id_fkey" FOREIGN KEY ("customer_advance_id") REFERENCES "ar_advance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_vendor_advance_id_fkey" FOREIGN KEY ("vendor_advance_id") REFERENCES "ap_advance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
