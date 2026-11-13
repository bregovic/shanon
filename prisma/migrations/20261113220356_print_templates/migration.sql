-- CreateTable
CREATE TABLE "prt_template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "doc_type" VARCHAR(40) NOT NULL,
    "paper" VARCHAR(40) NOT NULL DEFAULT 'a4',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "layout" TEXT,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "prt_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prt_template_tenant_id_company_id_idx" ON "prt_template"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "prt_template_tenant_id_company_id_code_key" ON "prt_template"("tenant_id", "company_id", "code");

-- AddForeignKey
ALTER TABLE "prt_template" ADD CONSTRAINT "prt_template_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
