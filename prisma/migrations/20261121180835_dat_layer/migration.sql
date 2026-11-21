-- AlterTable
ALTER TABLE "prt_template" ADD COLUMN     "dat_local" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dat_source_id" VARCHAR(36);

-- AlterTable
ALTER TABLE "tax_payment_term" ADD COLUMN     "dat_local" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dat_source_id" VARCHAR(36);

-- AlterTable
ALTER TABLE "inv_unit" ADD COLUMN     "dat_local" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dat_source_id" VARCHAR(36);

-- AlterTable
ALTER TABLE "bank_statement_format" ADD COLUMN     "dat_local" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dat_source_id" VARCHAR(36);

-- AlterTable
ALTER TABLE "bank_payment_method" ADD COLUMN     "dat_local" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dat_source_id" VARCHAR(36);
