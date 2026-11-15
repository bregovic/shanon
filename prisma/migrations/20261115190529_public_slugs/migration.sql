-- AlterTable
ALTER TABLE "org_entity" ADD COLUMN     "public_slug" VARCHAR(40);

-- AlterTable
ALTER TABLE "int_portal" ADD COLUMN     "slug" VARCHAR(40) DEFAULT 'doklady';

-- CreateTable
CREATE TABLE "sys_global_key" (
    "namespace" VARCHAR(40) NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_global_key_pkey" PRIMARY KEY ("namespace","key")
);

-- CreateIndex
CREATE INDEX "sys_global_key_tenant_id_owner_id_idx" ON "sys_global_key"("tenant_id", "owner_id");
