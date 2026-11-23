-- AlterTable
ALTER TABLE "pos_register" ADD COLUMN     "station_printer_id" UUID;

-- CreateIndex
CREATE INDEX "pos_register_station_printer_id_idx" ON "pos_register"("station_printer_id");

-- AddForeignKey
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_station_printer_id_fkey" FOREIGN KEY ("station_printer_id") REFERENCES "int_device_printer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
