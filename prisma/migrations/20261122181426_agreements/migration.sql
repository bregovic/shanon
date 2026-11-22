-- AlterTable
ALTER TABLE "inv_item" ADD COLUMN     "agreement_months" INTEGER;

-- AlterTable
ALTER TABLE "ar_parameters" ADD COLUMN     "agreement_block_days" INTEGER DEFAULT 14,
ADD COLUMN     "agreement_due_days" INTEGER DEFAULT 7,
ADD COLUMN     "agreement_renew_days" INTEGER DEFAULT 14;

-- AlterTable
ALTER TABLE "ar_order" ADD COLUMN     "agreement_id" UUID;

-- AlterTable
ALTER TABLE "ar_invoice" ADD COLUMN     "agreement_id" UUID;

-- AlterTable
ALTER TABLE "ar_advance" ADD COLUMN     "agreement_id" UUID;

-- AlterTable
ALTER TABLE "ap_parameters" ADD COLUMN     "agreement_block_days" INTEGER DEFAULT 14,
ADD COLUMN     "agreement_due_days" INTEGER DEFAULT 7,
ADD COLUMN     "agreement_renew_days" INTEGER DEFAULT 14;

-- AlterTable
ALTER TABLE "ap_order" ADD COLUMN     "agreement_id" UUID;

-- AlterTable
ALTER TABLE "ap_invoice" ADD COLUMN     "agreement_id" UUID;

-- AlterTable
ALTER TABLE "ap_advance" ADD COLUMN     "agreement_id" UUID;

-- CreateTable
CREATE TABLE "ar_agreement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "agreement_num" VARCHAR(20) NOT NULL,
    "customer_id" UUID NOT NULL,
    "item_id" UUID,
    "description" VARCHAR(255),
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_id" UUID,
    "period_months" INTEGER NOT NULL DEFAULT 1,
    "start_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_date" DATE,
    "auto_renew" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(40) NOT NULL DEFAULT 'draft',
    "paid_until" DATE,
    "period_from" DATE,
    "period_to" DATE,
    "due_date" DATE,
    "order_id" UUID,
    "advance_id" UUID,
    "blocked_date" DATE,
    "signed_at" TIMESTAMP(3),
    "terms" TEXT,
    "notes" TEXT,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ar_agreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_agreement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "agreement_num" VARCHAR(20) NOT NULL,
    "vendor_id" UUID NOT NULL,
    "item_id" UUID,
    "description" VARCHAR(255),
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_id" UUID,
    "period_months" INTEGER NOT NULL DEFAULT 1,
    "start_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_date" DATE,
    "auto_renew" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(40) NOT NULL DEFAULT 'draft',
    "paid_until" DATE,
    "period_from" DATE,
    "period_to" DATE,
    "due_date" DATE,
    "order_id" UUID,
    "advance_id" UUID,
    "blocked_date" DATE,
    "signed_at" TIMESTAMP(3),
    "terms" TEXT,
    "notes" TEXT,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ap_agreement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ar_agreement_tenant_id_company_id_idx" ON "ar_agreement"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ar_agreement_customer_id_idx" ON "ar_agreement"("customer_id");

-- CreateIndex
CREATE INDEX "ar_agreement_item_id_idx" ON "ar_agreement"("item_id");

-- CreateIndex
CREATE INDEX "ar_agreement_currency_id_idx" ON "ar_agreement"("currency_id");

-- CreateIndex
CREATE INDEX "ar_agreement_order_id_idx" ON "ar_agreement"("order_id");

-- CreateIndex
CREATE INDEX "ar_agreement_advance_id_idx" ON "ar_agreement"("advance_id");

-- CreateIndex
CREATE INDEX "ar_agreement_tenant_id_company_id_status_idx" ON "ar_agreement"("tenant_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "ap_agreement_tenant_id_company_id_idx" ON "ap_agreement"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ap_agreement_vendor_id_idx" ON "ap_agreement"("vendor_id");

-- CreateIndex
CREATE INDEX "ap_agreement_item_id_idx" ON "ap_agreement"("item_id");

-- CreateIndex
CREATE INDEX "ap_agreement_currency_id_idx" ON "ap_agreement"("currency_id");

-- CreateIndex
CREATE INDEX "ap_agreement_order_id_idx" ON "ap_agreement"("order_id");

-- CreateIndex
CREATE INDEX "ap_agreement_advance_id_idx" ON "ap_agreement"("advance_id");

-- CreateIndex
CREATE INDEX "ap_agreement_tenant_id_company_id_status_idx" ON "ap_agreement"("tenant_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "ar_order_agreement_id_idx" ON "ar_order"("agreement_id");

-- CreateIndex
CREATE INDEX "ar_invoice_agreement_id_idx" ON "ar_invoice"("agreement_id");

-- CreateIndex
CREATE INDEX "ar_advance_agreement_id_idx" ON "ar_advance"("agreement_id");

-- CreateIndex
CREATE INDEX "ap_order_agreement_id_idx" ON "ap_order"("agreement_id");

-- CreateIndex
CREATE INDEX "ap_invoice_agreement_id_idx" ON "ap_invoice"("agreement_id");

-- CreateIndex
CREATE INDEX "ap_advance_agreement_id_idx" ON "ap_advance"("agreement_id");

-- AddForeignKey
ALTER TABLE "ar_agreement" ADD CONSTRAINT "ar_agreement_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_agreement" ADD CONSTRAINT "ar_agreement_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "ar_customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_agreement" ADD CONSTRAINT "ar_agreement_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inv_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_agreement" ADD CONSTRAINT "ar_agreement_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_agreement" ADD CONSTRAINT "ar_agreement_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ar_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_agreement" ADD CONSTRAINT "ar_agreement_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "ar_advance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_order" ADD CONSTRAINT "ar_order_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "ar_agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice" ADD CONSTRAINT "ar_invoice_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "ar_agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_advance" ADD CONSTRAINT "ar_advance_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "ar_agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_agreement" ADD CONSTRAINT "ap_agreement_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_agreement" ADD CONSTRAINT "ap_agreement_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "ap_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_agreement" ADD CONSTRAINT "ap_agreement_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inv_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_agreement" ADD CONSTRAINT "ap_agreement_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_agreement" ADD CONSTRAINT "ap_agreement_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ap_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_agreement" ADD CONSTRAINT "ap_agreement_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "ap_advance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_order" ADD CONSTRAINT "ap_order_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "ap_agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice" ADD CONSTRAINT "ap_invoice_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "ap_agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_advance" ADD CONSTRAINT "ap_advance_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "ap_agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AlterTable
ALTER TABLE "ar_agreement" ALTER COLUMN "amount" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ap_agreement" ALTER COLUMN "amount" DROP NOT NULL;
-- AlterTable
ALTER TABLE "int_portal" ADD COLUMN     "agreement_group_id" UUID,
ADD COLUMN     "agreement_terms" TEXT,
ADD COLUMN     "purpose" VARCHAR(40) NOT NULL DEFAULT 'documents';

-- CreateIndex
CREATE INDEX "int_portal_agreement_group_id_idx" ON "int_portal"("agreement_group_id");

-- AddForeignKey
ALTER TABLE "int_portal" ADD CONSTRAINT "int_portal_agreement_group_id_fkey" FOREIGN KEY ("agreement_group_id") REFERENCES "ar_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
