-- AlterTable
ALTER TABLE "inv_category" ADD COLUMN     "description" TEXT,
ADD COLUMN     "eshop" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "image" VARCHAR(36),
ADD COLUMN     "slug" VARCHAR(60);
