-- CreateTable
CREATE TABLE "org_entity" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "legal_name" VARCHAR(120) NOT NULL,
    "trade_name" VARCHAR(120),
    "legal_form" VARCHAR(40) NOT NULL DEFAULT 'legal',
    "first_name" VARCHAR(60),
    "last_name" VARCHAR(60),
    "reg_no" VARCHAR(12),
    "vat_id" VARCHAR(16),
    "vat_payer" BOOLEAN NOT NULL DEFAULT true,
    "registration" VARCHAR(255),
    "street" VARCHAR(120),
    "house_no" VARCHAR(10),
    "orient_no" VARCHAR(10),
    "city" VARCHAR(80),
    "zip_code" VARCHAR(10),
    "country" VARCHAR(2) NOT NULL DEFAULT 'CZ',
    "email" VARCHAR(254),
    "phone" VARCHAR(30),
    "web" VARCHAR(200),
    "data_box_id" VARCHAR(7),
    "bank_account" VARCHAR(30),
    "iban" VARCHAR(34),
    "bic" VARCHAR(11),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "org_entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_site" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "street" VARCHAR(120),
    "house_no" VARCHAR(10),
    "orient_no" VARCHAR(10),
    "city" VARCHAR(80),
    "zip_code" VARCHAR(10),
    "phone" VARCHAR(30),
    "opening_hours" VARCHAR(255),
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "org_site_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_entity_tenant_id_company_id_idx" ON "org_entity"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "org_site_tenant_id_company_id_idx" ON "org_site"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_site_tenant_id_company_id_code_key" ON "org_site"("tenant_id", "company_id", "code");

-- AddForeignKey
ALTER TABLE "org_entity" ADD CONSTRAINT "org_entity_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_site" ADD CONSTRAINT "org_site_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
