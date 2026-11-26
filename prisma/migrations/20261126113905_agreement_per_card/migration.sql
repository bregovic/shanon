-- AlterTable
ALTER TABLE "inv_item" ADD COLUMN     "agreement_per_unit" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ar_agreement" ADD COLUMN     "quantity" INTEGER DEFAULT 1;

-- AlterTable
ALTER TABLE "ap_agreement" ADD COLUMN     "quantity" INTEGER DEFAULT 1;
