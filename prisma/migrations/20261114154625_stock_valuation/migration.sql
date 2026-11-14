-- AlterTable
ALTER TABLE "whs_trans" ADD COLUMN     "unit_cost" DECIMAL(18,2),
ADD COLUMN     "value" DECIMAL(18,2),
ADD COLUMN     "voucher_id" UUID;

-- AlterTable
ALTER TABLE "whs_journal_line" ADD COLUMN     "unit_cost" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "whs_parameters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL DEFAULT 'SKLAD',
    "valuation" BOOLEAN NOT NULL DEFAULT false,
    "stock_account_id" UUID,
    "in_transit_account_id" UUID,
    "cogs_account_id" UUID,
    "loss_account_id" UUID,
    "gain_account_id" UUID,
    "scrap_account_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "whs_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whs_item_cost" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "avg_cost" DECIMAL(18,2),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "whs_item_cost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whs_parameters_tenant_id_company_id_idx" ON "whs_parameters"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "whs_parameters_stock_account_id_idx" ON "whs_parameters"("stock_account_id");

-- CreateIndex
CREATE INDEX "whs_parameters_in_transit_account_id_idx" ON "whs_parameters"("in_transit_account_id");

-- CreateIndex
CREATE INDEX "whs_parameters_cogs_account_id_idx" ON "whs_parameters"("cogs_account_id");

-- CreateIndex
CREATE INDEX "whs_parameters_loss_account_id_idx" ON "whs_parameters"("loss_account_id");

-- CreateIndex
CREATE INDEX "whs_parameters_gain_account_id_idx" ON "whs_parameters"("gain_account_id");

-- CreateIndex
CREATE INDEX "whs_parameters_scrap_account_id_idx" ON "whs_parameters"("scrap_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "whs_parameters_tenant_id_company_id_code_key" ON "whs_parameters"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "whs_item_cost_tenant_id_company_id_idx" ON "whs_item_cost"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "whs_item_cost_item_id_idx" ON "whs_item_cost"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "whs_item_cost_tenant_id_company_id_item_id_key" ON "whs_item_cost"("tenant_id", "company_id", "item_id");

-- CreateIndex
CREATE INDEX "whs_trans_voucher_id_idx" ON "whs_trans"("voucher_id");

-- AddForeignKey
ALTER TABLE "whs_trans" ADD CONSTRAINT "whs_trans_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "gl_voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_parameters" ADD CONSTRAINT "whs_parameters_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_parameters" ADD CONSTRAINT "whs_parameters_stock_account_id_fkey" FOREIGN KEY ("stock_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_parameters" ADD CONSTRAINT "whs_parameters_in_transit_account_id_fkey" FOREIGN KEY ("in_transit_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_parameters" ADD CONSTRAINT "whs_parameters_cogs_account_id_fkey" FOREIGN KEY ("cogs_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_parameters" ADD CONSTRAINT "whs_parameters_loss_account_id_fkey" FOREIGN KEY ("loss_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_parameters" ADD CONSTRAINT "whs_parameters_gain_account_id_fkey" FOREIGN KEY ("gain_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_parameters" ADD CONSTRAINT "whs_parameters_scrap_account_id_fkey" FOREIGN KEY ("scrap_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_item_cost" ADD CONSTRAINT "whs_item_cost_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_item_cost" ADD CONSTRAINT "whs_item_cost_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inv_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
