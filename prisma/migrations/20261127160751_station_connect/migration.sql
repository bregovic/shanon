-- AlterTable
ALTER TABLE "int_device" ADD COLUMN     "browser_info" VARCHAR(200),
ADD COLUMN     "browser_seen_at" TIMESTAMP(3),
ADD COLUMN     "connect_queue" VARCHAR(2000),
ADD COLUMN     "connect_result" VARCHAR(500);

-- AlterTable
ALTER TABLE "int_printer_model" ADD COLUMN     "connect_path" VARCHAR(260);
