-- CreateTable
CREATE TABLE "sys_last_value" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" VARCHAR(80) NOT NULL,
    "object_id" VARCHAR(80) NOT NULL,
    "field" VARCHAR(80) NOT NULL,
    "value" VARCHAR(255),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sys_last_value_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sys_last_value_tenant_id_company_id_idx" ON "sys_last_value"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_last_value_tenant_id_company_id_user_id_object_id_field_key" ON "sys_last_value"("tenant_id", "company_id", "user_id", "object_id", "field");

-- AddForeignKey
ALTER TABLE "sys_last_value" ADD CONSTRAINT "sys_last_value_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
