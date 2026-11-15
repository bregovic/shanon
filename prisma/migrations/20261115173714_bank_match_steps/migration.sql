-- AlterTable
ALTER TABLE "bank_statement_line" ADD COLUMN     "customer_id" UUID,
ADD COLUMN     "vendor_id" UUID;

-- CreateTable
CREATE TABLE "bank_match_step" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "method" VARCHAR(40) NOT NULL,
    "require_amount" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "bank_match_step_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_match_step_tenant_id_company_id_idx" ON "bank_match_step"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_match_step_tenant_id_company_id_method_key" ON "bank_match_step"("tenant_id", "company_id", "method");

-- CreateIndex
CREATE INDEX "bank_statement_line_customer_id_idx" ON "bank_statement_line"("customer_id");

-- CreateIndex
CREATE INDEX "bank_statement_line_vendor_id_idx" ON "bank_statement_line"("vendor_id");

-- AddForeignKey
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "ar_customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "ap_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_match_step" ADD CONSTRAINT "bank_match_step_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
