-- AlterTable
ALTER TABLE "pos_receipt" ADD COLUMN     "customer_id" UUID;

-- CreateIndex
CREATE INDEX "pos_receipt_customer_id_idx" ON "pos_receipt"("customer_id");

-- AddForeignKey
ALTER TABLE "pos_receipt" ADD CONSTRAINT "pos_receipt_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "ar_customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
