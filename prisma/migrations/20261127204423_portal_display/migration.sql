-- AlterTable
ALTER TABLE "int_portal" ADD COLUMN     "register_id" UUID;

-- CreateIndex
CREATE INDEX "int_portal_register_id_idx" ON "int_portal"("register_id");

-- AddForeignKey
ALTER TABLE "int_portal" ADD CONSTRAINT "int_portal_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "pos_register"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
