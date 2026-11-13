-- CreateTable
CREATE TABLE "tax_parameters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "tax_office_code" VARCHAR(4) NOT NULL,
    "tax_office_branch" VARCHAR(5),
    "subject_type" VARCHAR(40) NOT NULL DEFAULT 'P',
    "filing_period" VARCHAR(40) NOT NULL DEFAULT 'month',
    "first_name" VARCHAR(40),
    "last_name" VARCHAR(40),
    "street" VARCHAR(60),
    "house_no" VARCHAR(10),
    "orient_no" VARCHAR(10),
    "city" VARCHAR(60),
    "zip_code" VARCHAR(6),
    "phone" VARCHAR(30),
    "email" VARCHAR(254),
    "data_box_id" VARCHAR(7),
    "preparer_first_name" VARCHAR(40),
    "preparer_last_name" VARCHAR(40),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "tax_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_return" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "period" VARCHAR(7),
    "kind" VARCHAR(40) NOT NULL DEFAULT 'dp3',
    "year" INTEGER NOT NULL,
    "month" INTEGER,
    "quarter" INTEGER,
    "status" VARCHAR(40) NOT NULL DEFAULT 'draft',
    "computed_at" DATE,
    "out21_base" DECIMAL(18,2),
    "out21_tax" DECIMAL(18,2),
    "out12_base" DECIMAL(18,2),
    "out12_tax" DECIMAL(18,2),
    "in21_base" DECIMAL(18,2),
    "in21_tax" DECIMAL(18,2),
    "in12_base" DECIMAL(18,2),
    "in12_tax" DECIMAL(18,2),
    "tax_out" DECIMAL(18,2),
    "deduction" DECIMAL(18,2),
    "result" DECIMAL(18,2),
    "a4_count" INTEGER,
    "b2_count" INTEGER,
    "warnings" TEXT,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "tax_return_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_parameters_tenant_id_company_id_idx" ON "tax_parameters"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "tax_return_tenant_id_company_id_idx" ON "tax_return"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_return_tenant_id_company_id_kind_period_key" ON "tax_return"("tenant_id", "company_id", "kind", "period");

-- AddForeignKey
ALTER TABLE "tax_parameters" ADD CONSTRAINT "tax_parameters_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return" ADD CONSTRAINT "tax_return_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
