-- AlterTable
ALTER TABLE "int_portal" ADD COLUMN     "accent2_color" VARCHAR(7),
ADD COLUMN     "accent_color" VARCHAR(7),
ADD COLUMN     "background" VARCHAR(40) NOT NULL DEFAULT 'gradient',
ADD COLUMN     "background_image" VARCHAR(36),
ADD COLUMN     "corners" VARCHAR(40) NOT NULL DEFAULT 'rounded',
ADD COLUMN     "footer" TEXT,
ADD COLUMN     "logo" VARCHAR(36),
ADD COLUMN     "show_company" BOOLEAN NOT NULL DEFAULT true;
