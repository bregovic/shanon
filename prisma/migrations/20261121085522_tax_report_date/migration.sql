-- AlterTable
ALTER TABLE "tax_code" ADD COLUMN     "deferrable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tax_trans" ADD COLUMN     "report_date" DATE;

-- stávající kódy: nárok lze uplatnit později u přijatých plnění bez samovyměření
UPDATE "tax_code" SET "deferrable" = true WHERE "direction" = 'input' AND "reverse_charge" = false;
