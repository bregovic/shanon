-- AlterTable
ALTER TABLE "int_device" ADD COLUMN     "hello_wanted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "int_device_printer" ADD COLUMN     "queued" INTEGER,
ADD COLUMN     "state" VARCHAR(40),
ADD COLUMN     "state_at" TIMESTAMP(3);
