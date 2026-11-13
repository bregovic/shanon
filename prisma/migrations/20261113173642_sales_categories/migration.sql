-- AlterTable
ALTER TABLE "inv_item" ADD COLUMN     "category_id" UUID;

-- CreateTable
CREATE TABLE "inv_category" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "parent_id" UUID,
    "sort_order" INTEGER DEFAULT 100,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "inv_category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inv_category_tenant_id_company_id_idx" ON "inv_category"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "inv_category_parent_id_idx" ON "inv_category"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "inv_category_tenant_id_company_id_code_key" ON "inv_category"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "inv_item_category_id_idx" ON "inv_item"("category_id");

-- AddForeignKey
ALTER TABLE "inv_category" ADD CONSTRAINT "inv_category_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_category" ADD CONSTRAINT "inv_category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "inv_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_item" ADD CONSTRAINT "inv_item_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "inv_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
