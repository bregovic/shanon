-- AlterTable
ALTER TABLE "gl_trans" ADD COLUMN     "amount_cur" DECIMAL(18,2),
ADD COLUMN     "currency_id" UUID;

-- AlterTable
ALTER TABLE "gl_journal_line" ADD COLUMN     "currency_id" UUID;

-- CreateTable
CREATE TABLE "sys_currency" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(3) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "symbol" VARCHAR(5),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sys_currency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_exchange_rate" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 1,
    "rate" DECIMAL(18,6) NOT NULL,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sys_exchange_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_fiscal_year" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gl_fiscal_year_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_period" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "fiscal_year_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'open',
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gl_period_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sys_currency_tenant_id_idx" ON "sys_currency"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_currency_tenant_id_code_key" ON "sys_currency"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "sys_exchange_rate_tenant_id_idx" ON "sys_exchange_rate"("tenant_id");

-- CreateIndex
CREATE INDEX "sys_exchange_rate_currency_id_idx" ON "sys_exchange_rate"("currency_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_exchange_rate_tenant_id_currency_id_date_key" ON "sys_exchange_rate"("tenant_id", "currency_id", "date");

-- CreateIndex
CREATE INDEX "gl_fiscal_year_tenant_id_company_id_idx" ON "gl_fiscal_year"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "gl_fiscal_year_tenant_id_company_id_code_key" ON "gl_fiscal_year"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "gl_period_tenant_id_company_id_idx" ON "gl_period"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "gl_period_fiscal_year_id_idx" ON "gl_period"("fiscal_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "gl_period_tenant_id_company_id_code_key" ON "gl_period"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "gl_trans_currency_id_idx" ON "gl_trans"("currency_id");

-- CreateIndex
CREATE INDEX "gl_journal_line_currency_id_idx" ON "gl_journal_line"("currency_id");

-- AddForeignKey
ALTER TABLE "sys_exchange_rate" ADD CONSTRAINT "sys_exchange_rate_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_fiscal_year" ADD CONSTRAINT "gl_fiscal_year_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_period" ADD CONSTRAINT "gl_period_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_period" ADD CONSTRAINT "gl_period_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "gl_fiscal_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_trans" ADD CONSTRAINT "gl_trans_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_line" ADD CONSTRAINT "gl_journal_line_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
