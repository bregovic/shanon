-- AlterTable
ALTER TABLE "bank_statement_line" ADD COLUMN     "journal_id" UUID,
ADD COLUMN     "posting_rule_id" UUID;

-- CreateTable
CREATE TABLE "bank_posting_rule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "text_contains" VARCHAR(255),
    "counter_contains" VARCHAR(255),
    "direction" VARCHAR(40) NOT NULL DEFAULT 'any',
    "offset_account_id" UUID NOT NULL,
    "priority" INTEGER DEFAULT 10,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "bank_posting_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_posting_rule_tenant_id_company_id_idx" ON "bank_posting_rule"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "bank_posting_rule_offset_account_id_idx" ON "bank_posting_rule"("offset_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_posting_rule_tenant_id_company_id_code_key" ON "bank_posting_rule"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "bank_statement_line_posting_rule_id_idx" ON "bank_statement_line"("posting_rule_id");

-- CreateIndex
CREATE INDEX "bank_statement_line_journal_id_idx" ON "bank_statement_line"("journal_id");

-- AddForeignKey
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_posting_rule_id_fkey" FOREIGN KEY ("posting_rule_id") REFERENCES "bank_posting_rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "gl_journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_posting_rule" ADD CONSTRAINT "bank_posting_rule_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_posting_rule" ADD CONSTRAINT "bank_posting_rule_offset_account_id_fkey" FOREIGN KEY ("offset_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
