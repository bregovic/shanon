-- AlterTable
ALTER TABLE "ar_advance" ADD COLUMN     "tax_amount" DECIMAL(18,2),
ADD COLUMN     "tax_base" DECIMAL(18,2),
ADD COLUMN     "tax_code_id" UUID,
ADD COLUMN     "tax_date" DATE,
ADD COLUMN     "tax_doc_num" VARCHAR(20);

-- AlterTable
ALTER TABLE "ap_advance" ADD COLUMN     "tax_amount" DECIMAL(18,2),
ADD COLUMN     "tax_base" DECIMAL(18,2),
ADD COLUMN     "tax_code_id" UUID,
ADD COLUMN     "tax_date" DATE,
ADD COLUMN     "tax_doc_num" VARCHAR(20);

-- CreateIndex
CREATE INDEX "ar_advance_tax_code_id_idx" ON "ar_advance"("tax_code_id");

-- CreateIndex
CREATE INDEX "ap_advance_tax_code_id_idx" ON "ap_advance"("tax_code_id");

-- AddForeignKey
ALTER TABLE "ar_advance" ADD CONSTRAINT "ar_advance_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_advance" ADD CONSTRAINT "ap_advance_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
