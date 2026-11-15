-- AlterTable
ALTER TABLE "ar_invoice" ADD COLUMN     "bank_account_id" UUID,
ADD COLUMN     "payment_method_id" UUID;

-- CreateIndex
CREATE INDEX "ar_invoice_bank_account_id_idx" ON "ar_invoice"("bank_account_id");

-- CreateIndex
CREATE INDEX "ar_invoice_payment_method_id_idx" ON "ar_invoice"("payment_method_id");

-- AddForeignKey
ALTER TABLE "ar_invoice" ADD CONSTRAINT "ar_invoice_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice" ADD CONSTRAINT "ar_invoice_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "bank_payment_method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
