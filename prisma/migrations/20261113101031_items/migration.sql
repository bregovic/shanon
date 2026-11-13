-- AlterTable
ALTER TABLE "ar_invoice_line" ADD COLUMN     "item_id" UUID,
ADD COLUMN     "unit_id" UUID,
ALTER COLUMN "description" DROP NOT NULL,
ALTER COLUMN "unit_price" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ap_invoice_line" ADD COLUMN     "item_id" UUID,
ADD COLUMN     "unit_id" UUID,
ALTER COLUMN "description" DROP NOT NULL,
ALTER COLUMN "unit_price" DROP NOT NULL;

-- CreateTable
CREATE TABLE "inv_unit" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "decimals" INTEGER DEFAULT 0,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "inv_unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inv_item_group" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "tax_code_id" UUID,
    "revenue_account_id" UUID,
    "purchase_tax_code_id" UUID,
    "cost_account_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "inv_item_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inv_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "item_num" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "item_type" VARCHAR(40) NOT NULL DEFAULT 'item',
    "group_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "ean" VARCHAR(14),
    "sales_price" DECIMAL(18,2),
    "price_incl_tax" BOOLEAN NOT NULL DEFAULT false,
    "tax_code_id" UUID,
    "price_net" DECIMAL(18,2),
    "price_gross" DECIMAL(18,2),
    "purchase_price" DECIMAL(18,2),
    "weighed" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "inv_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inv_unit_tenant_id_company_id_idx" ON "inv_unit"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "inv_unit_tenant_id_company_id_code_key" ON "inv_unit"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "inv_item_group_tenant_id_company_id_idx" ON "inv_item_group"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "inv_item_group_tax_code_id_idx" ON "inv_item_group"("tax_code_id");

-- CreateIndex
CREATE INDEX "inv_item_group_revenue_account_id_idx" ON "inv_item_group"("revenue_account_id");

-- CreateIndex
CREATE INDEX "inv_item_group_purchase_tax_code_id_idx" ON "inv_item_group"("purchase_tax_code_id");

-- CreateIndex
CREATE INDEX "inv_item_group_cost_account_id_idx" ON "inv_item_group"("cost_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "inv_item_group_tenant_id_company_id_code_key" ON "inv_item_group"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "inv_item_tenant_id_company_id_idx" ON "inv_item"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "inv_item_group_id_idx" ON "inv_item"("group_id");

-- CreateIndex
CREATE INDEX "inv_item_unit_id_idx" ON "inv_item"("unit_id");

-- CreateIndex
CREATE INDEX "inv_item_tax_code_id_idx" ON "inv_item"("tax_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "inv_item_tenant_id_company_id_item_num_key" ON "inv_item"("tenant_id", "company_id", "item_num");

-- CreateIndex
CREATE INDEX "ar_invoice_line_item_id_idx" ON "ar_invoice_line"("item_id");

-- CreateIndex
CREATE INDEX "ar_invoice_line_unit_id_idx" ON "ar_invoice_line"("unit_id");

-- CreateIndex
CREATE INDEX "ap_invoice_line_item_id_idx" ON "ap_invoice_line"("item_id");

-- CreateIndex
CREATE INDEX "ap_invoice_line_unit_id_idx" ON "ap_invoice_line"("unit_id");

-- AddForeignKey
ALTER TABLE "inv_unit" ADD CONSTRAINT "inv_unit_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_item_group" ADD CONSTRAINT "inv_item_group_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_item_group" ADD CONSTRAINT "inv_item_group_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_item_group" ADD CONSTRAINT "inv_item_group_revenue_account_id_fkey" FOREIGN KEY ("revenue_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_item_group" ADD CONSTRAINT "inv_item_group_purchase_tax_code_id_fkey" FOREIGN KEY ("purchase_tax_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_item_group" ADD CONSTRAINT "inv_item_group_cost_account_id_fkey" FOREIGN KEY ("cost_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_item" ADD CONSTRAINT "inv_item_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_item" ADD CONSTRAINT "inv_item_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "inv_item_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_item" ADD CONSTRAINT "inv_item_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "inv_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_item" ADD CONSTRAINT "inv_item_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice_line" ADD CONSTRAINT "ar_invoice_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inv_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice_line" ADD CONSTRAINT "ar_invoice_line_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "inv_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice_line" ADD CONSTRAINT "ap_invoice_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inv_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice_line" ADD CONSTRAINT "ap_invoice_line_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "inv_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
