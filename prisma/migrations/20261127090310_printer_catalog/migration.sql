-- AlterTable
ALTER TABLE "int_device" ADD COLUMN     "usb_no_driver" VARCHAR(500);

-- AlterTable
ALTER TABLE "int_device_printer" ADD COLUMN     "driver_name" VARCHAR(200),
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "model_id" UUID;

-- CreateTable
CREATE TABLE "int_printer_model" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "match" VARCHAR(120) NOT NULL,
    "driver_url" VARCHAR(500),
    "paper" VARCHAR(40) NOT NULL DEFAULT 'a4',
    "copies" INTEGER DEFAULT 1,
    "usage" VARCHAR(40) NOT NULL DEFAULT 'documents',
    "notes" TEXT,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "int_printer_model_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "int_printer_model_tenant_id_company_id_idx" ON "int_printer_model"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "int_printer_model_tenant_id_company_id_match_key" ON "int_printer_model"("tenant_id", "company_id", "match");

-- CreateIndex
CREATE INDEX "int_device_printer_model_id_idx" ON "int_device_printer"("model_id");

-- AddForeignKey
ALTER TABLE "int_device_printer" ADD CONSTRAINT "int_device_printer_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "int_printer_model"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_printer_model" ADD CONSTRAINT "int_printer_model_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- stávající tiskárny: používat jen výchozí, účtenkové a ty, které má pravidlo tisku nebo pokladna
UPDATE "int_device_printer" p SET "enabled" = false
WHERE NOT p."is_default" AND p."paper" = 'a4'
  AND NOT EXISTS (SELECT 1 FROM "int_print_rule" r WHERE r."printer_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "pos_register" g WHERE g."station_printer_id" = p."id");
