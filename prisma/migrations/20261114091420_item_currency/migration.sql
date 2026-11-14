-- AlterTable
ALTER TABLE "inv_item" ADD COLUMN     "currency_id" UUID;

-- CreateIndex
CREATE INDEX "inv_item_currency_id_idx" ON "inv_item"("currency_id");

-- AddForeignKey
ALTER TABLE "inv_item" ADD CONSTRAINT "inv_item_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
