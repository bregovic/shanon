-- DropIndex
DROP INDEX "sys_exchange_rate_tenant_id_currency_id_date_base_source_key";

-- AlterTable
ALTER TABLE "sys_company" ADD COLUMN     "dat" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sys_exchange_rate" ADD COLUMN     "for_company_id" UUID;

-- CreateIndex
CREATE INDEX "sys_exchange_rate_for_company_id_idx" ON "sys_exchange_rate"("for_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_exchange_rate_tenant_id_currency_id_date_base_source_fo_key" ON "sys_exchange_rate"("tenant_id", "currency_id", "date", "base", "source", "for_company_id");

-- AddForeignKey
ALTER TABLE "sys_exchange_rate" ADD CONSTRAINT "sys_exchange_rate_for_company_id_fkey" FOREIGN KEY ("for_company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
