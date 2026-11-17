-- AlterTable
ALTER TABLE "shop_shop" ALTER COLUMN "pickup_lead_days" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "shop_order" ADD COLUMN     "pickup_asap" BOOLEAN NOT NULL DEFAULT false;
