-- AlterTable
ALTER TABLE "ar_agreement_line" ADD COLUMN     "payment_date" DATE;

-- AlterTable
ALTER TABLE "ar_trans" ADD COLUMN     "agreement_id" UUID;

-- AlterTable
ALTER TABLE "ap_agreement_line" ADD COLUMN     "payment_date" DATE;

-- AlterTable
ALTER TABLE "ap_trans" ADD COLUMN     "agreement_id" UUID;

-- CreateIndex
CREATE INDEX "ar_trans_agreement_id_idx" ON "ar_trans"("agreement_id");

-- CreateIndex
CREATE INDEX "ap_trans_agreement_id_idx" ON "ap_trans"("agreement_id");

-- AddForeignKey
ALTER TABLE "ar_trans" ADD CONSTRAINT "ar_trans_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "ar_agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_trans" ADD CONSTRAINT "ap_trans_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "ap_agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
