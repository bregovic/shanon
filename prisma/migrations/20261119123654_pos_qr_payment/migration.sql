-- AlterTable
ALTER TABLE "bank_statement_line" ADD COLUMN     "pos_receipt_id" UUID;

-- AlterTable
ALTER TABLE "pos_register" ADD COLUMN     "qr_account_id" UUID,
ADD COLUMN     "qr_bank_account_id" UUID;

-- AlterTable
ALTER TABLE "pos_shift" ADD COLUMN     "qr_total" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "pos_receipt" ADD COLUMN     "paid_date" DATE,
ADD COLUMN     "pay_status" VARCHAR(40),
ADD COLUMN     "vs" VARCHAR(10);

-- CreateIndex
CREATE INDEX "bank_statement_line_pos_receipt_id_idx" ON "bank_statement_line"("pos_receipt_id");

-- CreateIndex
CREATE INDEX "pos_register_qr_account_id_idx" ON "pos_register"("qr_account_id");

-- CreateIndex
CREATE INDEX "pos_register_qr_bank_account_id_idx" ON "pos_register"("qr_bank_account_id");

-- CreateIndex
CREATE INDEX "pos_receipt_tenant_id_company_id_vs_idx" ON "pos_receipt"("tenant_id", "company_id", "vs");

-- AddForeignKey
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_pos_receipt_id_fkey" FOREIGN KEY ("pos_receipt_id") REFERENCES "pos_receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_qr_account_id_fkey" FOREIGN KEY ("qr_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_qr_bank_account_id_fkey" FOREIGN KEY ("qr_bank_account_id") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
