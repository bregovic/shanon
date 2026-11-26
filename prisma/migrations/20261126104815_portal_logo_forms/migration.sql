-- AlterTable
ALTER TABLE "ar_agreement" ADD COLUMN     "form_data" TEXT,
ADD COLUMN     "form_text" TEXT;

-- AlterTable
ALTER TABLE "ap_agreement" ADD COLUMN     "form_data" TEXT,
ADD COLUMN     "form_text" TEXT;

-- AlterTable
ALTER TABLE "int_portal" ADD COLUMN     "form_id" UUID,
ADD COLUMN     "logo_align" VARCHAR(40) NOT NULL DEFAULT 'left',
ADD COLUMN     "logo_badge" VARCHAR(40) NOT NULL DEFAULT 'none',
ADD COLUMN     "logo_size" VARCHAR(40) NOT NULL DEFAULT 'medium';

-- CreateTable
CREATE TABLE "int_form" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "heading" VARCHAR(255),
    "intro" TEXT,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "int_form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "int_form_field" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "sequence" INTEGER DEFAULT 10,
    "key" VARCHAR(40) NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "kind" VARCHAR(40) NOT NULL DEFAULT 'text',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "mapping" VARCHAR(40) NOT NULL DEFAULT 'form',
    "options" TEXT,
    "help" VARCHAR(255),
    "width" VARCHAR(40) NOT NULL DEFAULT 'half',
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "int_form_field_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "int_form_tenant_id_company_id_idx" ON "int_form"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "int_form_tenant_id_company_id_code_key" ON "int_form"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "int_form_field_tenant_id_company_id_idx" ON "int_form_field"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "int_form_field_form_id_idx" ON "int_form_field"("form_id");

-- CreateIndex
CREATE UNIQUE INDEX "int_form_field_tenant_id_company_id_form_id_key_key" ON "int_form_field"("tenant_id", "company_id", "form_id", "key");

-- CreateIndex
CREATE INDEX "int_portal_form_id_idx" ON "int_portal"("form_id");

-- AddForeignKey
ALTER TABLE "int_portal" ADD CONSTRAINT "int_portal_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "int_form"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_form" ADD CONSTRAINT "int_form_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_form_field" ADD CONSTRAINT "int_form_field_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_form_field" ADD CONSTRAINT "int_form_field_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "int_form"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
