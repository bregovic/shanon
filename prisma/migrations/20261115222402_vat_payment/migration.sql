-- AlterTable
ALTER TABLE "tax_parameters" ADD COLUMN     "tax_office_vendor_id" UUID;

-- AlterTable
ALTER TABLE "tax_return" ADD COLUMN     "due_date" DATE,
ADD COLUMN     "payment_amount" DECIMAL(18,2),
ADD COLUMN     "payment_vs" VARCHAR(10),
ADD COLUMN     "voucher_id" UUID;

-- CreateIndex
CREATE INDEX "tax_parameters_tax_office_vendor_id_idx" ON "tax_parameters"("tax_office_vendor_id");

-- CreateIndex
CREATE INDEX "tax_return_voucher_id_idx" ON "tax_return"("voucher_id");

-- AddForeignKey
ALTER TABLE "tax_parameters" ADD CONSTRAINT "tax_parameters_tax_office_vendor_id_fkey" FOREIGN KEY ("tax_office_vendor_id") REFERENCES "ap_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return" ADD CONSTRAINT "tax_return_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "gl_voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
