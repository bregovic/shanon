-- AlterTable
ALTER TABLE "ar_parameters" ADD COLUMN     "agreement_mode" VARCHAR(40) NOT NULL DEFAULT 'advance';

-- AlterTable
ALTER TABLE "ar_agreement" ADD COLUMN     "card_number" VARCHAR(40),
ADD COLUMN     "vs" VARCHAR(10);

-- AlterTable
ALTER TABLE "ap_parameters" ADD COLUMN     "agreement_mode" VARCHAR(40) NOT NULL DEFAULT 'advance';

-- AlterTable
ALTER TABLE "ap_agreement" ADD COLUMN     "card_number" VARCHAR(40),
ADD COLUMN     "vs" VARCHAR(10);

-- AlterTable
ALTER TABLE "bank_statement_line" ADD COLUMN     "agreement_id" UUID;

-- CreateTable
CREATE TABLE "ar_agreement_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "line_num" INTEGER NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'planned',
    "order_id" UUID,
    "invoice_id" UUID,
    "due_date" DATE,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ar_agreement_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_agreement_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "line_num" INTEGER NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'planned',
    "order_id" UUID,
    "invoice_id" UUID,
    "due_date" DATE,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ap_agreement_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ar_agreement_line_tenant_id_company_id_idx" ON "ar_agreement_line"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ar_agreement_line_agreement_id_idx" ON "ar_agreement_line"("agreement_id");

-- CreateIndex
CREATE INDEX "ar_agreement_line_order_id_idx" ON "ar_agreement_line"("order_id");

-- CreateIndex
CREATE INDEX "ar_agreement_line_invoice_id_idx" ON "ar_agreement_line"("invoice_id");

-- CreateIndex
CREATE INDEX "ar_agreement_line_tenant_id_company_id_agreement_id_status_idx" ON "ar_agreement_line"("tenant_id", "company_id", "agreement_id", "status");

-- CreateIndex
CREATE INDEX "ap_agreement_line_tenant_id_company_id_idx" ON "ap_agreement_line"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ap_agreement_line_agreement_id_idx" ON "ap_agreement_line"("agreement_id");

-- CreateIndex
CREATE INDEX "ap_agreement_line_order_id_idx" ON "ap_agreement_line"("order_id");

-- CreateIndex
CREATE INDEX "ap_agreement_line_invoice_id_idx" ON "ap_agreement_line"("invoice_id");

-- CreateIndex
CREATE INDEX "ap_agreement_line_tenant_id_company_id_agreement_id_status_idx" ON "ap_agreement_line"("tenant_id", "company_id", "agreement_id", "status");

-- CreateIndex
CREATE INDEX "bank_statement_line_agreement_id_idx" ON "bank_statement_line"("agreement_id");

-- AddForeignKey
ALTER TABLE "ar_agreement_line" ADD CONSTRAINT "ar_agreement_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_agreement_line" ADD CONSTRAINT "ar_agreement_line_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "ar_agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_agreement_line" ADD CONSTRAINT "ar_agreement_line_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ar_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_agreement_line" ADD CONSTRAINT "ar_agreement_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ar_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_agreement_line" ADD CONSTRAINT "ap_agreement_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_agreement_line" ADD CONSTRAINT "ap_agreement_line_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "ap_agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_agreement_line" ADD CONSTRAINT "ap_agreement_line_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ap_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_agreement_line" ADD CONSTRAINT "ap_agreement_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ap_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "ar_agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
