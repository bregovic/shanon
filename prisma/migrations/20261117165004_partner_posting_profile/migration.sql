-- AlterTable
ALTER TABLE "ar_customer" ADD COLUMN     "posting_profile_id" UUID;

-- AlterTable
ALTER TABLE "ap_vendor" ADD COLUMN     "posting_profile_id" UUID;

-- CreateIndex
CREATE INDEX "ar_customer_posting_profile_id_idx" ON "ar_customer"("posting_profile_id");

-- CreateIndex
CREATE INDEX "ap_vendor_posting_profile_id_idx" ON "ap_vendor"("posting_profile_id");

-- AddForeignKey
ALTER TABLE "ar_customer" ADD CONSTRAINT "ar_customer_posting_profile_id_fkey" FOREIGN KEY ("posting_profile_id") REFERENCES "ar_posting_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_vendor" ADD CONSTRAINT "ap_vendor_posting_profile_id_fkey" FOREIGN KEY ("posting_profile_id") REFERENCES "ap_posting_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
