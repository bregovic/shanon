-- AlterTable
ALTER TABLE "int_device_printer" ADD COLUMN     "copy_from_id" UUID,
ALTER COLUMN "label" DROP NOT NULL,
ALTER COLUMN "printer_name" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "int_device_printer_copy_from_id_idx" ON "int_device_printer"("copy_from_id");

-- AddForeignKey
ALTER TABLE "int_device_printer" ADD CONSTRAINT "int_device_printer_copy_from_id_fkey" FOREIGN KEY ("copy_from_id") REFERENCES "int_device_printer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
