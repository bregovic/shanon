-- AlterTable
ALTER TABLE "pos_receipt_line" ADD COLUMN     "scale_name" VARCHAR(255),
ADD COLUMN     "scale_protocol" VARCHAR(20),
ADD COLUMN     "scale_raw" TEXT,
ADD COLUMN     "scale_serial" VARCHAR(255),
ADD COLUMN     "scale_total" DECIMAL(18,2),
ADD COLUMN     "scale_unit_price" DECIMAL(18,2),
ADD COLUMN     "scale_weight" DECIMAL(18,4),
ADD COLUMN     "weighed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "pos_basket_line" ADD COLUMN     "scale" TEXT;

-- AlterTable
ALTER TABLE "int_connection" ADD COLUMN     "scale_auto_add_sec" INTEGER DEFAULT 0,
ADD COLUMN     "scale_serial" VARCHAR(60);
