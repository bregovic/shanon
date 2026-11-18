-- AlterTable
ALTER TABLE "pos_receipt" ADD COLUMN     "buyer_city" VARCHAR(255),
ADD COLUMN     "buyer_name" VARCHAR(255),
ADD COLUMN     "buyer_street" VARCHAR(255),
ADD COLUMN     "buyer_zip" VARCHAR(20);
