-- AlterTable
ALTER TABLE "sys_user" ADD COLUMN     "notify" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "pos_pin_hash" TEXT;
