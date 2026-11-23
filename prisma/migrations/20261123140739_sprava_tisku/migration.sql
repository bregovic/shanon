-- Správa tisku: tiskárny zařízení (hlásí je stanice) + pravidla tisku místo napojení s ovladačem „station“.
-- Stávající nastavení se převede: napojení stanice → tiskárna zařízení (stejné id), „Doklady na tiskárnu“
-- → pravidla, tiskárna stanice vybraná na pokladně → pravidlo účtenky pro pokladnu, úlohy → nová tiskárna.

-- CreateTable
CREATE TABLE "int_device_printer" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "printer_name" VARCHAR(200) NOT NULL,
    "paper" VARCHAR(40) NOT NULL DEFAULT 'a4',
    "copies" INTEGER DEFAULT 1,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "int_device_printer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "int_print_rule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "doc_type" VARCHAR(40) NOT NULL,
    "printer_id" UUID NOT NULL,
    "from_device_id" UUID,
    "register_id" UUID,
    "user_id" VARCHAR(36),
    "auto_print" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "int_print_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "int_device_printer_tenant_id_company_id_idx" ON "int_device_printer"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "int_device_printer_device_id_idx" ON "int_device_printer"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "int_device_printer_tenant_id_company_id_device_id_printer_n_key" ON "int_device_printer"("tenant_id", "company_id", "device_id", "printer_name");

-- CreateIndex
CREATE INDEX "int_print_rule_tenant_id_company_id_idx" ON "int_print_rule"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "int_print_rule_printer_id_idx" ON "int_print_rule"("printer_id");

-- CreateIndex
CREATE INDEX "int_print_rule_from_device_id_idx" ON "int_print_rule"("from_device_id");

-- CreateIndex
CREATE INDEX "int_print_rule_register_id_idx" ON "int_print_rule"("register_id");

-- AlterTable
ALTER TABLE "int_device" ADD COLUMN "auto_name" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "int_print_job" ADD COLUMN "printer_id" UUID;

-- převod: napojení tiskové stanice → tiskárny zařízení
INSERT INTO "int_device_printer" ("id", "tenant_id", "company_id", "device_id", "label", "printer_name", "paper", "copies", "created_at", "created_by", "updated_at", "updated_by")
SELECT c."id", c."tenant_id", c."company_id", c."device_id", c."name", COALESCE(NULLIF(c."printer_name", ''), c."name"),
       CASE WHEN c."paper_width" IN ('80', '58', 'a6') THEN c."paper_width" ELSE '80' END, COALESCE(c."copies", 1),
       c."created_at", c."created_by", c."updated_at", c."updated_by"
FROM "int_connection" c
WHERE c."driver" = 'station' AND c."device_id" IS NOT NULL
ON CONFLICT DO NOTHING;

-- „Doklady na tiskárnu“ → pravidla Správy tisku
INSERT INTO "int_print_rule" ("id", "tenant_id", "company_id", "doc_type", "printer_id", "user_id", "created_at", "created_by", "updated_at", "updated_by")
SELECT r."id", r."tenant_id", r."company_id", r."doc_type", r."connection_id", r."user_id", r."created_at", r."created_by", r."updated_at", r."updated_by"
FROM "int_print_route" r
WHERE EXISTS (SELECT 1 FROM "int_device_printer" p WHERE p."id" = r."connection_id");

-- tiskárna stanice vybraná na pokladně → pravidlo účtenek té pokladny
INSERT INTO "int_print_rule" ("id", "tenant_id", "company_id", "doc_type", "printer_id", "register_id", "auto_print")
SELECT gen_random_uuid(), g."tenant_id", g."company_id", 'pos.receipt', g."printer_conn_id", g."id", COALESCE(c."auto_print", false)
FROM "pos_register" g
JOIN "int_device_printer" p ON p."id" = g."printer_conn_id"
JOIN "int_connection" c ON c."id" = g."printer_conn_id";
UPDATE "pos_register" SET "printer_conn_id" = NULL WHERE "printer_conn_id" IN (SELECT "id" FROM "int_device_printer");

-- úlohy ve frontě → nová tiskárna (úlohy bez ní se zahodí)
UPDATE "int_print_job" SET "printer_id" = "connection_id";
DELETE FROM "int_print_job" WHERE "printer_id" NOT IN (SELECT "id" FROM "int_device_printer");

-- napojení stanice zůstanou vypnutá (kvůli protokolu), jako tiskárna z prohlížeče
UPDATE "int_connection" SET "driver" = 'browser', "active" = false WHERE "driver" = 'station';

-- DropForeignKey
ALTER TABLE "int_connection" DROP CONSTRAINT "int_connection_device_id_fkey";
ALTER TABLE "int_print_route" DROP CONSTRAINT "int_print_route_company_id_fkey";
ALTER TABLE "int_print_route" DROP CONSTRAINT "int_print_route_connection_id_fkey";
ALTER TABLE "int_print_job" DROP CONSTRAINT "int_print_job_connection_id_fkey";

-- DropIndex
DROP INDEX "int_connection_device_id_idx";
DROP INDEX "int_print_job_connection_id_idx";

-- AlterTable
ALTER TABLE "int_connection" DROP COLUMN "copies",
DROP COLUMN "device_id",
DROP COLUMN "printer_name";
ALTER TABLE "int_device" DROP COLUMN "printers";
ALTER TABLE "int_print_job" DROP COLUMN "connection_id",
ALTER COLUMN "printer_id" SET NOT NULL;

-- DropTable
DROP TABLE "int_print_route";

-- CreateIndex
CREATE INDEX "int_print_job_printer_id_idx" ON "int_print_job"("printer_id");

-- AddForeignKey
ALTER TABLE "int_device_printer" ADD CONSTRAINT "int_device_printer_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_device_printer" ADD CONSTRAINT "int_device_printer_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "int_device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_print_rule" ADD CONSTRAINT "int_print_rule_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_print_rule" ADD CONSTRAINT "int_print_rule_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "int_device_printer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_print_rule" ADD CONSTRAINT "int_print_rule_from_device_id_fkey" FOREIGN KEY ("from_device_id") REFERENCES "int_device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_print_rule" ADD CONSTRAINT "int_print_rule_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "pos_register"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_print_job" ADD CONSTRAINT "int_print_job_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "int_device_printer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
