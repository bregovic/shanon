-- AlterTable
ALTER TABLE "gl_journal_settlement" ADD COLUMN     "agreement_id" UUID,
ADD COLUMN     "customer_advance_id" UUID,
ADD COLUMN     "settle_kind" VARCHAR(40) NOT NULL DEFAULT 'invoice',
ADD COLUMN     "vendor_advance_id" UUID;

-- CreateIndex
CREATE INDEX "gl_journal_settlement_customer_advance_id_idx" ON "gl_journal_settlement"("customer_advance_id");

-- CreateIndex
CREATE INDEX "gl_journal_settlement_vendor_advance_id_idx" ON "gl_journal_settlement"("vendor_advance_id");

-- CreateIndex
CREATE INDEX "gl_journal_settlement_agreement_id_idx" ON "gl_journal_settlement"("agreement_id");

-- AddForeignKey
ALTER TABLE "gl_journal_settlement" ADD CONSTRAINT "gl_journal_settlement_customer_advance_id_fkey" FOREIGN KEY ("customer_advance_id") REFERENCES "ar_advance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_settlement" ADD CONSTRAINT "gl_journal_settlement_vendor_advance_id_fkey" FOREIGN KEY ("vendor_advance_id") REFERENCES "ap_advance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_settlement" ADD CONSTRAINT "gl_journal_settlement_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "ar_agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
