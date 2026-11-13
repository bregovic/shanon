-- DropForeignKey
ALTER TABLE "gl_parameters" DROP CONSTRAINT "gl_parameters_realized_gain_account_id_fkey";

-- DropForeignKey
ALTER TABLE "gl_parameters" DROP CONSTRAINT "gl_parameters_realized_loss_account_id_fkey";

-- DropForeignKey
ALTER TABLE "gl_parameters" DROP CONSTRAINT "gl_parameters_rounding_gain_account_id_fkey";

-- DropForeignKey
ALTER TABLE "gl_parameters" DROP CONSTRAINT "gl_parameters_rounding_loss_account_id_fkey";

-- DropForeignKey
ALTER TABLE "gl_parameters" DROP CONSTRAINT "gl_parameters_profit_loss_account_id_fkey";

-- DropForeignKey
ALTER TABLE "gl_parameters" DROP CONSTRAINT "gl_parameters_retained_earnings_account_id_fkey";

-- DropForeignKey
ALTER TABLE "gl_parameters" DROP CONSTRAINT "gl_parameters_opening_account_id_fkey";

-- DropForeignKey
ALTER TABLE "gl_parameters" DROP CONSTRAINT "gl_parameters_closing_account_id_fkey";

-- DropForeignKey
ALTER TABLE "pos_register" DROP CONSTRAINT "pos_register_rounding_gain_account_id_fkey";

-- DropForeignKey
ALTER TABLE "pos_register" DROP CONSTRAINT "pos_register_rounding_loss_account_id_fkey";

-- DropIndex
DROP INDEX "gl_parameters_realized_gain_account_id_idx";

-- DropIndex
DROP INDEX "gl_parameters_realized_loss_account_id_idx";

-- DropIndex
DROP INDEX "gl_parameters_rounding_gain_account_id_idx";

-- DropIndex
DROP INDEX "gl_parameters_rounding_loss_account_id_idx";

-- DropIndex
DROP INDEX "gl_parameters_profit_loss_account_id_idx";

-- DropIndex
DROP INDEX "gl_parameters_retained_earnings_account_id_idx";

-- DropIndex
DROP INDEX "gl_parameters_opening_account_id_idx";

-- DropIndex
DROP INDEX "gl_parameters_closing_account_id_idx";

-- DropIndex
DROP INDEX "pos_register_rounding_gain_account_id_idx";

-- DropIndex
DROP INDEX "pos_register_rounding_loss_account_id_idx";

-- AlterTable
ALTER TABLE "sys_currency" ADD COLUMN     "cash_rounding_method" VARCHAR(40) NOT NULL DEFAULT 'nearest',
ADD COLUMN     "cash_rounding_unit" DECIMAL(10,4) NOT NULL DEFAULT 0.01,
ADD COLUMN     "rounding_unit" DECIMAL(10,4) NOT NULL DEFAULT 0.01;


-- AlterTable
ALTER TABLE "pos_register" DROP COLUMN "round_cash",
DROP COLUMN "rounding_gain_account_id",
DROP COLUMN "rounding_loss_account_id";

-- CreateTable
CREATE TABLE "gl_system_account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "posting_type" VARCHAR(40) NOT NULL,
    "account_id" UUID NOT NULL,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gl_system_account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gl_system_account_tenant_id_company_id_idx" ON "gl_system_account"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "gl_system_account_account_id_idx" ON "gl_system_account"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "gl_system_account_tenant_id_company_id_posting_type_key" ON "gl_system_account"("tenant_id", "company_id", "posting_type");

-- AddForeignKey
ALTER TABLE "gl_system_account" ADD CONSTRAINT "gl_system_account_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_system_account" ADD CONSTRAINT "gl_system_account_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data: účty z parametrů hlavní knihy → systémové účty (zbytek doplní výchozí nastavení)
INSERT INTO "gl_system_account" ("id","tenant_id","company_id","posting_type","account_id") SELECT gen_random_uuid(), "tenant_id", "company_id", 'realizedGain', "realized_gain_account_id" FROM "gl_parameters" WHERE "realized_gain_account_id" IS NOT NULL;
INSERT INTO "gl_system_account" ("id","tenant_id","company_id","posting_type","account_id") SELECT gen_random_uuid(), "tenant_id", "company_id", 'realizedLoss', "realized_loss_account_id" FROM "gl_parameters" WHERE "realized_loss_account_id" IS NOT NULL;
INSERT INTO "gl_system_account" ("id","tenant_id","company_id","posting_type","account_id") SELECT gen_random_uuid(), "tenant_id", "company_id", 'roundingGain', "rounding_gain_account_id" FROM "gl_parameters" WHERE "rounding_gain_account_id" IS NOT NULL;
INSERT INTO "gl_system_account" ("id","tenant_id","company_id","posting_type","account_id") SELECT gen_random_uuid(), "tenant_id", "company_id", 'roundingLoss', "rounding_loss_account_id" FROM "gl_parameters" WHERE "rounding_loss_account_id" IS NOT NULL;
INSERT INTO "gl_system_account" ("id","tenant_id","company_id","posting_type","account_id") SELECT gen_random_uuid(), "tenant_id", "company_id", 'profitLoss', "profit_loss_account_id" FROM "gl_parameters" WHERE "profit_loss_account_id" IS NOT NULL;
INSERT INTO "gl_system_account" ("id","tenant_id","company_id","posting_type","account_id") SELECT gen_random_uuid(), "tenant_id", "company_id", 'retainedEarnings', "retained_earnings_account_id" FROM "gl_parameters" WHERE "retained_earnings_account_id" IS NOT NULL;
INSERT INTO "gl_system_account" ("id","tenant_id","company_id","posting_type","account_id") SELECT gen_random_uuid(), "tenant_id", "company_id", 'opening', "opening_account_id" FROM "gl_parameters" WHERE "opening_account_id" IS NOT NULL;
INSERT INTO "gl_system_account" ("id","tenant_id","company_id","posting_type","account_id") SELECT gen_random_uuid(), "tenant_id", "company_id", 'closing', "closing_account_id" FROM "gl_parameters" WHERE "closing_account_id" IS NOT NULL;

-- Data: hotovost v CZK se zaokrouhluje na koruny
UPDATE "sys_currency" SET "cash_rounding_unit" = 1 WHERE "code" = 'CZK';

-- AlterTable
ALTER TABLE "gl_parameters" DROP COLUMN "closing_account_id",
DROP COLUMN "opening_account_id",
DROP COLUMN "profit_loss_account_id",
DROP COLUMN "realized_gain_account_id",
DROP COLUMN "realized_loss_account_id",
DROP COLUMN "retained_earnings_account_id",
DROP COLUMN "rounding_gain_account_id",
DROP COLUMN "rounding_loss_account_id";
