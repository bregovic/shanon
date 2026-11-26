-- AlterTable
ALTER TABLE "gl_journal_line" ADD COLUMN     "settle_status" VARCHAR(40) DEFAULT 'none';

-- CreateTable
CREATE TABLE "gl_journal_settlement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "journal_line_id" UUID NOT NULL,
    "partner_type" VARCHAR(40) NOT NULL,
    "customer_trans_id" UUID,
    "vendor_trans_id" UUID,
    "amount" DECIMAL(18,2) NOT NULL,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gl_journal_settlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gl_journal_settlement_tenant_id_company_id_idx" ON "gl_journal_settlement"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "gl_journal_settlement_journal_id_idx" ON "gl_journal_settlement"("journal_id");

-- CreateIndex
CREATE INDEX "gl_journal_settlement_journal_line_id_idx" ON "gl_journal_settlement"("journal_line_id");

-- CreateIndex
CREATE INDEX "gl_journal_settlement_customer_trans_id_idx" ON "gl_journal_settlement"("customer_trans_id");

-- CreateIndex
CREATE INDEX "gl_journal_settlement_vendor_trans_id_idx" ON "gl_journal_settlement"("vendor_trans_id");

-- CreateIndex
CREATE INDEX "gl_journal_settlement_tenant_id_company_id_journal_id_idx" ON "gl_journal_settlement"("tenant_id", "company_id", "journal_id");

-- CreateIndex
CREATE INDEX "gl_journal_settlement_tenant_id_company_id_journal_line_id_idx" ON "gl_journal_settlement"("tenant_id", "company_id", "journal_line_id");

-- AddForeignKey
ALTER TABLE "gl_journal_settlement" ADD CONSTRAINT "gl_journal_settlement_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_settlement" ADD CONSTRAINT "gl_journal_settlement_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "gl_journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_settlement" ADD CONSTRAINT "gl_journal_settlement_journal_line_id_fkey" FOREIGN KEY ("journal_line_id") REFERENCES "gl_journal_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_settlement" ADD CONSTRAINT "gl_journal_settlement_customer_trans_id_fkey" FOREIGN KEY ("customer_trans_id") REFERENCES "ar_trans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_settlement" ADD CONSTRAINT "gl_journal_settlement_vendor_trans_id_fkey" FOREIGN KEY ("vendor_trans_id") REFERENCES "ap_trans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
