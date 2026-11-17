-- AlterTable
ALTER TABLE "int_connection" ADD COLUMN     "pay_methods" VARCHAR(200),
ADD COLUMN     "pos_qr" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "push_url" VARCHAR(200),
ADD COLUMN     "test_mode" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "shop_order" ADD COLUMN     "payment_log_id" UUID;

-- CreateIndex
CREATE INDEX "shop_order_payment_log_id_idx" ON "shop_order"("payment_log_id");

-- AddForeignKey
ALTER TABLE "shop_order" ADD CONSTRAINT "shop_order_payment_log_id_fkey" FOREIGN KEY ("payment_log_id") REFERENCES "int_log"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
