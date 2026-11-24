-- AlterTable
ALTER TABLE "shop_shop" ADD COLUMN     "accent2_color" VARCHAR(7),
ADD COLUMN     "hero_animation" VARCHAR(40) NOT NULL DEFAULT 'none',
ADD COLUMN     "hero_style" VARCHAR(40) NOT NULL DEFAULT 'split';
