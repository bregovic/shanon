-- DropIndex
DROP INDEX "gl_voucher_tenant_id_company_id_voucher_num_key";

-- číslo dokladu už není jedinečné (opravné deníky), hledání podle něj ale zůstane rychlé
CREATE INDEX "gl_voucher_voucher_num_idx" ON "gl_voucher"("tenant_id", "company_id", "voucher_num");

-- AlterTable
ALTER TABLE "gl_parameters" ADD COLUMN     "voucher_dup_check" VARCHAR(40) NOT NULL DEFAULT 'reject';

-- CreateTable
CREATE TABLE "ar_parameters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_num_check" VARCHAR(40) NOT NULL DEFAULT 'reject',
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ar_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_parameters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_num_check" VARCHAR(40) NOT NULL DEFAULT 'reject',
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ap_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ar_parameters_tenant_id_company_id_idx" ON "ar_parameters"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ap_parameters_tenant_id_company_id_idx" ON "ap_parameters"("tenant_id", "company_id");

-- AddForeignKey
ALTER TABLE "ar_parameters" ADD CONSTRAINT "ar_parameters_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_parameters" ADD CONSTRAINT "ap_parameters_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
