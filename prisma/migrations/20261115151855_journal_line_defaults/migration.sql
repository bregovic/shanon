-- AlterTable
ALTER TABLE "gl_journal_name" ADD COLUMN     "dim1" VARCHAR(20),
ADD COLUMN     "dim2" VARCHAR(20),
ADD COLUMN     "dim3" VARCHAR(20),
ADD COLUMN     "dim4" VARCHAR(20),
ADD COLUMN     "dim5" VARCHAR(20),
ADD COLUMN     "dim6" VARCHAR(20);

-- AlterTable
ALTER TABLE "gl_journal" ADD COLUMN     "dim1" VARCHAR(20),
ADD COLUMN     "dim2" VARCHAR(20),
ADD COLUMN     "dim3" VARCHAR(20),
ADD COLUMN     "dim4" VARCHAR(20),
ADD COLUMN     "dim5" VARCHAR(20),
ADD COLUMN     "dim6" VARCHAR(20),
ADD COLUMN     "offset_account_id" UUID,
ADD COLUMN     "offset_bank_account_id" UUID,
ADD COLUMN     "offset_cash_desk_id" UUID,
ADD COLUMN     "offset_customer_id" UUID,
ADD COLUMN     "offset_type" VARCHAR(40),
ADD COLUMN     "offset_vendor_id" UUID;

-- CreateIndex
CREATE INDEX "gl_journal_offset_account_id_idx" ON "gl_journal"("offset_account_id");

-- CreateIndex
CREATE INDEX "gl_journal_offset_customer_id_idx" ON "gl_journal"("offset_customer_id");

-- CreateIndex
CREATE INDEX "gl_journal_offset_vendor_id_idx" ON "gl_journal"("offset_vendor_id");

-- CreateIndex
CREATE INDEX "gl_journal_offset_bank_account_id_idx" ON "gl_journal"("offset_bank_account_id");

-- CreateIndex
CREATE INDEX "gl_journal_offset_cash_desk_id_idx" ON "gl_journal"("offset_cash_desk_id");

-- AddForeignKey
ALTER TABLE "gl_journal" ADD CONSTRAINT "gl_journal_offset_account_id_fkey" FOREIGN KEY ("offset_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal" ADD CONSTRAINT "gl_journal_offset_customer_id_fkey" FOREIGN KEY ("offset_customer_id") REFERENCES "ar_customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal" ADD CONSTRAINT "gl_journal_offset_vendor_id_fkey" FOREIGN KEY ("offset_vendor_id") REFERENCES "ap_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal" ADD CONSTRAINT "gl_journal_offset_bank_account_id_fkey" FOREIGN KEY ("offset_bank_account_id") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal" ADD CONSTRAINT "gl_journal_offset_cash_desk_id_fkey" FOREIGN KEY ("offset_cash_desk_id") REFERENCES "cash_desk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
