-- AlterTable
ALTER TABLE "inv_item" ADD COLUMN     "brand" VARCHAR(60);

-- AlterTable
ALTER TABLE "ar_customer" ADD COLUMN     "reg_no" VARCHAR(12),
ALTER COLUMN "subject_id" DROP NOT NULL,
ALTER COLUMN "group_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ap_vendor" ADD COLUMN     "reg_no" VARCHAR(12),
ALTER COLUMN "subject_id" DROP NOT NULL,
ALTER COLUMN "group_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ar_customer_tenant_id_company_id_reg_no_key" ON "ar_customer"("tenant_id", "company_id", "reg_no");

-- CreateIndex
CREATE UNIQUE INDEX "ap_vendor_tenant_id_company_id_reg_no_key" ON "ap_vendor"("tenant_id", "company_id", "reg_no");
