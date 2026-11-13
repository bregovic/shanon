-- DropForeignKey
ALTER TABLE "gl_account" DROP CONSTRAINT "gl_account_parent_id_fkey";

-- DropIndex
DROP INDEX "gl_account_parent_id_idx";

-- AlterTable
ALTER TABLE "gl_account" DROP COLUMN "level",
DROP COLUMN "parent_id",
ADD COLUMN     "synthetic" VARCHAR(3),
ALTER COLUMN "account_num" SET DATA TYPE VARCHAR(6);
