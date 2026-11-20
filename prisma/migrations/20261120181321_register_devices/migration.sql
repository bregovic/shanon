-- AlterTable
ALTER TABLE "pos_register" ADD COLUMN     "printer_conn_id" UUID,
ADD COLUMN     "scale_conn_id" UUID;

-- CreateIndex
CREATE INDEX "pos_register_scale_conn_id_idx" ON "pos_register"("scale_conn_id");

-- CreateIndex
CREATE INDEX "pos_register_printer_conn_id_idx" ON "pos_register"("printer_conn_id");

-- AddForeignKey
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_scale_conn_id_fkey" FOREIGN KEY ("scale_conn_id") REFERENCES "int_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_printer_conn_id_fkey" FOREIGN KEY ("printer_conn_id") REFERENCES "int_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- dosavadní vazba napojení → pokladna: přenést na pokladnu (váha, tiskárna)
UPDATE "pos_register" r SET "scale_conn_id" = c."id" FROM "int_connection" c WHERE c."register_id" = r."id" AND c."kind" = 'scale' AND r."scale_conn_id" IS NULL;
UPDATE "pos_register" r SET "printer_conn_id" = c."id" FROM "int_connection" c WHERE c."register_id" = r."id" AND c."kind" = 'printer' AND r."printer_conn_id" IS NULL;
