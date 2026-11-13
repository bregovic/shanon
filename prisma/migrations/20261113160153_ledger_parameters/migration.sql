-- DropIndex
DROP INDEX "sys_exchange_rate_tenant_id_currency_id_date_key";

-- AlterTable
ALTER TABLE "sys_exchange_rate" ADD COLUMN     "base" VARCHAR(3) NOT NULL DEFAULT 'CZK',
ADD COLUMN     "source" VARCHAR(40) NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "gl_parameters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "accounting_currency_id" UUID NOT NULL,
    "reporting_currency_id" UUID,
    "rate_source" VARCHAR(40) NOT NULL DEFAULT 'cnb',
    "rate_max_age_days" INTEGER NOT NULL DEFAULT 7,
    "realized_gain_account_id" UUID,
    "realized_loss_account_id" UUID,
    "rounding_gain_account_id" UUID,
    "rounding_loss_account_id" UUID,
    "profit_loss_account_id" UUID,
    "retained_earnings_account_id" UUID,
    "opening_account_id" UUID,
    "closing_account_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gl_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gl_parameters_tenant_id_company_id_idx" ON "gl_parameters"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "gl_parameters_accounting_currency_id_idx" ON "gl_parameters"("accounting_currency_id");

-- CreateIndex
CREATE INDEX "gl_parameters_reporting_currency_id_idx" ON "gl_parameters"("reporting_currency_id");

-- CreateIndex
CREATE INDEX "gl_parameters_realized_gain_account_id_idx" ON "gl_parameters"("realized_gain_account_id");

-- CreateIndex
CREATE INDEX "gl_parameters_realized_loss_account_id_idx" ON "gl_parameters"("realized_loss_account_id");

-- CreateIndex
CREATE INDEX "gl_parameters_rounding_gain_account_id_idx" ON "gl_parameters"("rounding_gain_account_id");

-- CreateIndex
CREATE INDEX "gl_parameters_rounding_loss_account_id_idx" ON "gl_parameters"("rounding_loss_account_id");

-- CreateIndex
CREATE INDEX "gl_parameters_profit_loss_account_id_idx" ON "gl_parameters"("profit_loss_account_id");

-- CreateIndex
CREATE INDEX "gl_parameters_retained_earnings_account_id_idx" ON "gl_parameters"("retained_earnings_account_id");

-- CreateIndex
CREATE INDEX "gl_parameters_opening_account_id_idx" ON "gl_parameters"("opening_account_id");

-- CreateIndex
CREATE INDEX "gl_parameters_closing_account_id_idx" ON "gl_parameters"("closing_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_exchange_rate_tenant_id_currency_id_date_base_source_key" ON "sys_exchange_rate"("tenant_id", "currency_id", "date", "base", "source");

-- AddForeignKey
ALTER TABLE "gl_parameters" ADD CONSTRAINT "gl_parameters_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_parameters" ADD CONSTRAINT "gl_parameters_accounting_currency_id_fkey" FOREIGN KEY ("accounting_currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_parameters" ADD CONSTRAINT "gl_parameters_reporting_currency_id_fkey" FOREIGN KEY ("reporting_currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_parameters" ADD CONSTRAINT "gl_parameters_realized_gain_account_id_fkey" FOREIGN KEY ("realized_gain_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_parameters" ADD CONSTRAINT "gl_parameters_realized_loss_account_id_fkey" FOREIGN KEY ("realized_loss_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_parameters" ADD CONSTRAINT "gl_parameters_rounding_gain_account_id_fkey" FOREIGN KEY ("rounding_gain_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_parameters" ADD CONSTRAINT "gl_parameters_rounding_loss_account_id_fkey" FOREIGN KEY ("rounding_loss_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_parameters" ADD CONSTRAINT "gl_parameters_profit_loss_account_id_fkey" FOREIGN KEY ("profit_loss_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_parameters" ADD CONSTRAINT "gl_parameters_retained_earnings_account_id_fkey" FOREIGN KEY ("retained_earnings_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_parameters" ADD CONSTRAINT "gl_parameters_opening_account_id_fkey" FOREIGN KEY ("opening_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_parameters" ADD CONSTRAINT "gl_parameters_closing_account_id_fkey" FOREIGN KEY ("closing_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
