-- AlterTable
ALTER TABLE "sys_number_seq" ADD COLUMN     "used_for" VARCHAR(40);

-- AlterTable
ALTER TABLE "gl_journal" ADD COLUMN     "journal_name_id" UUID;

-- CreateTable
CREATE TABLE "gl_journal_name" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "voucher_seq_id" UUID,
    "offset_account_id" UUID,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gl_journal_name_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gl_journal_name_tenant_id_company_id_idx" ON "gl_journal_name"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "gl_journal_name_voucher_seq_id_idx" ON "gl_journal_name"("voucher_seq_id");

-- CreateIndex
CREATE INDEX "gl_journal_name_offset_account_id_idx" ON "gl_journal_name"("offset_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "gl_journal_name_tenant_id_company_id_code_key" ON "gl_journal_name"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sys_number_seq_tenant_id_company_id_used_for_key" ON "sys_number_seq"("tenant_id", "company_id", "used_for");

-- CreateIndex
CREATE INDEX "gl_journal_journal_name_id_idx" ON "gl_journal"("journal_name_id");

-- AddForeignKey
ALTER TABLE "gl_journal_name" ADD CONSTRAINT "gl_journal_name_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_name" ADD CONSTRAINT "gl_journal_name_voucher_seq_id_fkey" FOREIGN KEY ("voucher_seq_id") REFERENCES "sys_number_seq"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_name" ADD CONSTRAINT "gl_journal_name_offset_account_id_fkey" FOREIGN KEY ("offset_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal" ADD CONSTRAINT "gl_journal_journal_name_id_fkey" FOREIGN KEY ("journal_name_id") REFERENCES "gl_journal_name"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
