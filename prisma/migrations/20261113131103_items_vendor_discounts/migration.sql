-- AlterTable
ALTER TABLE "inv_item" ADD COLUMN     "margin_pct" DECIMAL(7,4),
ADD COLUMN     "vendor_id" UUID,
ADD COLUMN     "vendor_item_name" VARCHAR(255);

-- AlterTable
ALTER TABLE "pos_receipt_line" ADD COLUMN     "discount_id" UUID,
ADD COLUMN     "original_price" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "inv_discount" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(40) NOT NULL DEFAULT 'percent',
    "percent" DECIMAL(7,4),
    "price" DECIMAL(18,2),
    "item_id" UUID,
    "group_id" UUID,
    "valid_from" DATE,
    "valid_to" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "inv_discount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inv_discount_tenant_id_company_id_idx" ON "inv_discount"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "inv_discount_item_id_idx" ON "inv_discount"("item_id");

-- CreateIndex
CREATE INDEX "inv_discount_group_id_idx" ON "inv_discount"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "inv_discount_tenant_id_company_id_code_key" ON "inv_discount"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "inv_item_vendor_id_idx" ON "inv_item"("vendor_id");

-- CreateIndex
CREATE INDEX "pos_receipt_line_discount_id_idx" ON "pos_receipt_line"("discount_id");

-- AddForeignKey
ALTER TABLE "inv_item" ADD CONSTRAINT "inv_item_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "ap_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_discount" ADD CONSTRAINT "inv_discount_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_discount" ADD CONSTRAINT "inv_discount_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inv_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_discount" ADD CONSTRAINT "inv_discount_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "inv_item_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_receipt_line" ADD CONSTRAINT "pos_receipt_line_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "inv_discount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
