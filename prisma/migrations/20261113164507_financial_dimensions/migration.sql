-- CreateTable
CREATE TABLE "gl_dimension" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "position" INTEGER NOT NULL,
    "source" VARCHAR(40) NOT NULL DEFAULT 'custom',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gl_dimension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_dimension_value" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "dimension_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gl_dimension_value_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_dimension_rule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "dimension_id" UUID NOT NULL,
    "account_mask" VARCHAR(6) NOT NULL,
    "requirement" VARCHAR(40) NOT NULL DEFAULT 'mandatory',
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gl_dimension_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gl_dimension_tenant_id_idx" ON "gl_dimension"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "gl_dimension_tenant_id_code_key" ON "gl_dimension"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "gl_dimension_tenant_id_position_key" ON "gl_dimension"("tenant_id", "position");

-- CreateIndex
CREATE INDEX "gl_dimension_value_tenant_id_idx" ON "gl_dimension_value"("tenant_id");

-- CreateIndex
CREATE INDEX "gl_dimension_value_dimension_id_idx" ON "gl_dimension_value"("dimension_id");

-- CreateIndex
CREATE UNIQUE INDEX "gl_dimension_value_tenant_id_dimension_id_code_key" ON "gl_dimension_value"("tenant_id", "dimension_id", "code");

-- CreateIndex
CREATE INDEX "gl_dimension_rule_tenant_id_company_id_idx" ON "gl_dimension_rule"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "gl_dimension_rule_dimension_id_idx" ON "gl_dimension_rule"("dimension_id");

-- CreateIndex
CREATE UNIQUE INDEX "gl_dimension_rule_tenant_id_company_id_dimension_id_account_key" ON "gl_dimension_rule"("tenant_id", "company_id", "dimension_id", "account_mask");

-- AddForeignKey
ALTER TABLE "gl_dimension_value" ADD CONSTRAINT "gl_dimension_value_dimension_id_fkey" FOREIGN KEY ("dimension_id") REFERENCES "gl_dimension"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_dimension_rule" ADD CONSTRAINT "gl_dimension_rule_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_dimension_rule" ADD CONSTRAINT "gl_dimension_rule_dimension_id_fkey" FOREIGN KEY ("dimension_id") REFERENCES "gl_dimension"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "gl_account" ADD COLUMN     "dim1_req" VARCHAR(40),
ADD COLUMN     "dim2_req" VARCHAR(40),
ADD COLUMN     "dim3_req" VARCHAR(40),
ADD COLUMN     "dim4_req" VARCHAR(40),
ADD COLUMN     "dim5_req" VARCHAR(40),
ADD COLUMN     "dim6_req" VARCHAR(40);

-- AlterTable
ALTER TABLE "gl_trans" ADD COLUMN "dim1" VARCHAR(20),
ADD COLUMN "dim2" VARCHAR(20),
ADD COLUMN "dim3" VARCHAR(20),
ADD COLUMN "dim4" VARCHAR(20),
ADD COLUMN "dim5" VARCHAR(20),
ADD COLUMN "dim6" VARCHAR(20);

-- AlterTable
ALTER TABLE "gl_journal_line" ADD COLUMN "dim1" VARCHAR(20),
ADD COLUMN "dim2" VARCHAR(20),
ADD COLUMN "dim3" VARCHAR(20),
ADD COLUMN "dim4" VARCHAR(20),
ADD COLUMN "dim5" VARCHAR(20),
ADD COLUMN "dim6" VARCHAR(20);

-- AlterTable
ALTER TABLE "ar_invoice_line" ADD COLUMN "dim1" VARCHAR(20),
ADD COLUMN "dim2" VARCHAR(20),
ADD COLUMN "dim3" VARCHAR(20),
ADD COLUMN "dim4" VARCHAR(20),
ADD COLUMN "dim5" VARCHAR(20),
ADD COLUMN "dim6" VARCHAR(20);

-- AlterTable
ALTER TABLE "ap_invoice_line" ADD COLUMN "dim1" VARCHAR(20),
ADD COLUMN "dim2" VARCHAR(20),
ADD COLUMN "dim3" VARCHAR(20),
ADD COLUMN "dim4" VARCHAR(20),
ADD COLUMN "dim5" VARCHAR(20),
ADD COLUMN "dim6" VARCHAR(20);

-- Převod středisek: dimenze Středisko (pořadí 1), hodnoty a jejich použití do dim1
INSERT INTO "gl_dimension" ("id", "tenant_id", "code", "name", "position", "source", "active")
SELECT gen_random_uuid(), t."tenant_id", 'STR', 'Středisko', 1, 'custom', true
FROM (SELECT DISTINCT "tenant_id" FROM "gl_cost_center") t;

INSERT INTO "gl_dimension_value" ("id", "tenant_id", "dimension_id", "code", "name")
SELECT gen_random_uuid(), x."tenant_id", x."dimension_id", x."code", x."name"
FROM (
  SELECT DISTINCT ON (c."tenant_id", c."code") c."tenant_id", d."id" AS "dimension_id", c."code", c."name"
  FROM "gl_cost_center" c JOIN "gl_dimension" d ON d."tenant_id" = c."tenant_id" AND d."code" = 'STR'
  ORDER BY c."tenant_id", c."code"
) x;

UPDATE "gl_trans" x SET "dim1" = c."code" FROM "gl_cost_center" c WHERE x."cost_center_id" = c."id";
UPDATE "gl_journal_line" x SET "dim1" = c."code" FROM "gl_cost_center" c WHERE x."cost_center_id" = c."id";
UPDATE "ar_invoice_line" x SET "dim1" = c."code" FROM "gl_cost_center" c WHERE x."cost_center_id" = c."id";
UPDATE "ap_invoice_line" x SET "dim1" = c."code" FROM "gl_cost_center" c WHERE x."cost_center_id" = c."id";

-- DropForeignKey
ALTER TABLE "gl_cost_center" DROP CONSTRAINT "gl_cost_center_company_id_fkey";

-- DropForeignKey
ALTER TABLE "gl_trans" DROP CONSTRAINT "gl_trans_cost_center_id_fkey";

-- DropForeignKey
ALTER TABLE "gl_journal_line" DROP CONSTRAINT "gl_journal_line_cost_center_id_fkey";

-- DropForeignKey
ALTER TABLE "ar_invoice_line" DROP CONSTRAINT "ar_invoice_line_cost_center_id_fkey";

-- DropForeignKey
ALTER TABLE "ap_invoice_line" DROP CONSTRAINT "ap_invoice_line_cost_center_id_fkey";

-- DropIndex
DROP INDEX "gl_trans_cost_center_id_idx";

-- DropIndex
DROP INDEX "gl_journal_line_cost_center_id_idx";

-- DropIndex
DROP INDEX "ar_invoice_line_cost_center_id_idx";

-- DropIndex
DROP INDEX "ap_invoice_line_cost_center_id_idx";

-- AlterTable
ALTER TABLE "gl_trans" DROP COLUMN "cost_center_id";

-- AlterTable
ALTER TABLE "gl_journal_line" DROP COLUMN "cost_center_id";

-- AlterTable
ALTER TABLE "ar_invoice_line" DROP COLUMN "cost_center_id";

-- AlterTable
ALTER TABLE "ap_invoice_line" DROP COLUMN "cost_center_id";

-- DropTable
DROP TABLE "gl_cost_center";
