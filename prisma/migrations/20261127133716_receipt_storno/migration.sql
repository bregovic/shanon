-- AlterTable
ALTER TABLE "pos_receipt" ADD COLUMN     "storno_id" UUID,
ADD COLUMN     "storno_of_id" UUID;

-- CreateIndex
CREATE INDEX "pos_receipt_storno_of_id_idx" ON "pos_receipt"("storno_of_id");

-- CreateIndex
CREATE INDEX "pos_receipt_storno_id_idx" ON "pos_receipt"("storno_id");

-- AddForeignKey
ALTER TABLE "pos_receipt" ADD CONSTRAINT "pos_receipt_storno_of_id_fkey" FOREIGN KEY ("storno_of_id") REFERENCES "pos_receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_receipt" ADD CONSTRAINT "pos_receipt_storno_id_fkey" FOREIGN KEY ("storno_id") REFERENCES "pos_receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- řada účtenek souvislá: číslo smazané poslední účtenky otevřené směny dostane další prodej
UPDATE "sys_number_seq" SET "continuous" = true WHERE "used_for" = 'pos.receipt' OR "code" = 'POSRCPT';
