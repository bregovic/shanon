-- AlterTable
ALTER TABLE "gl_journal_line" ALTER COLUMN "offset_type" SET DEFAULT 'ledger';

-- AlterTable
ALTER TABLE "bank_account" ADD COLUMN     "statement_format_id" UUID;

-- AlterTable
ALTER TABLE "bank_payment_order" ALTER COLUMN "payment_method_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "bank_statement_format" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "transformation_id" UUID NOT NULL,
    "detect" VARCHAR(120),
    "file_name_pattern" VARCHAR(200),
    "encoding" VARCHAR(40) NOT NULL DEFAULT 'cp1250',
    "delimiter" VARCHAR(3) NOT NULL DEFAULT ';',
    "decimal_separator" VARCHAR(1) NOT NULL DEFAULT ',',
    "date_format" VARCHAR(20) NOT NULL DEFAULT 'dd.MM.yyyy',
    "lines_start" VARCHAR(120),
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "bank_statement_format_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_format_field" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "format_id" UUID NOT NULL,
    "section" VARCHAR(40) NOT NULL DEFAULT 'line',
    "target" VARCHAR(40) NOT NULL,
    "source" VARCHAR(120) NOT NULL,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "bank_statement_format_field_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_statement_format_tenant_id_company_id_idx" ON "bank_statement_format"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "bank_statement_format_transformation_id_idx" ON "bank_statement_format"("transformation_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_format_tenant_id_company_id_code_key" ON "bank_statement_format"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "bank_statement_format_field_tenant_id_company_id_idx" ON "bank_statement_format_field"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "bank_statement_format_field_format_id_idx" ON "bank_statement_format_field"("format_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_format_field_tenant_id_company_id_format_id__key" ON "bank_statement_format_field"("tenant_id", "company_id", "format_id", "section", "target");

-- CreateIndex
CREATE INDEX "bank_account_statement_format_id_idx" ON "bank_account"("statement_format_id");

-- AddForeignKey
ALTER TABLE "bank_statement_format" ADD CONSTRAINT "bank_statement_format_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_format" ADD CONSTRAINT "bank_statement_format_transformation_id_fkey" FOREIGN KEY ("transformation_id") REFERENCES "sys_transformation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_format_field" ADD CONSTRAINT "bank_statement_format_field_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_format_field" ADD CONSTRAINT "bank_statement_format_field_format_id_fkey" FOREIGN KEY ("format_id") REFERENCES "bank_statement_format"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_statement_format_id_fkey" FOREIGN KEY ("statement_format_id") REFERENCES "bank_statement_format"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
