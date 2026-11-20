-- DropForeignKey
ALTER TABLE "pos_register" DROP CONSTRAINT "pos_register_qr_account_id_fkey";

-- DropIndex
DROP INDEX "pos_register_qr_account_id_idx";

-- AlterTable
ALTER TABLE "pos_register" DROP COLUMN "qr_account_id";
