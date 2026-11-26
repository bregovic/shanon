-- AlterTable
ALTER TABLE "ar_agreement" ADD COLUMN     "payment_log_id" UUID,
ADD COLUMN     "start_on_payment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ap_agreement" ADD COLUMN     "payment_log_id" UUID,
ADD COLUMN     "start_on_payment" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "ar_agreement_payment_log_id_idx" ON "ar_agreement"("payment_log_id");

-- CreateIndex
CREATE INDEX "ap_agreement_payment_log_id_idx" ON "ap_agreement"("payment_log_id");

-- AddForeignKey
ALTER TABLE "ar_agreement" ADD CONSTRAINT "ar_agreement_payment_log_id_fkey" FOREIGN KEY ("payment_log_id") REFERENCES "int_log"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_agreement" ADD CONSTRAINT "ap_agreement_payment_log_id_fkey" FOREIGN KEY ("payment_log_id") REFERENCES "int_log"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
