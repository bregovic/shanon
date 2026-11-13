-- AlterTable
ALTER TABLE "gl_account" ADD COLUMN     "account_class" INTEGER,
ADD COLUMN     "level" VARCHAR(40),
ADD COLUMN     "no_manual_entry" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parent_id" UUID,
ADD COLUMN     "posting_type" VARCHAR(40),
ALTER COLUMN "type" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "gl_account_parent_id_idx" ON "gl_account"("parent_id");

-- AddForeignKey
ALTER TABLE "gl_account" ADD CONSTRAINT "gl_account_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
