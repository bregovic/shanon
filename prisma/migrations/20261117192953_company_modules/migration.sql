-- CreateTable
CREATE TABLE "sys_company_module" (
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "module_id" VARCHAR(40) NOT NULL,
    "enabled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_company_module_pkey" PRIMARY KEY ("company_id","module_id")
);

-- CreateIndex
CREATE INDEX "sys_company_module_tenant_id_idx" ON "sys_company_module"("tenant_id");

-- AddForeignKey
ALTER TABLE "sys_company_module" ADD CONSTRAINT "sys_company_module_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "sys_tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
