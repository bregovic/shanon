-- AlterTable
ALTER TABLE "int_document" ADD COLUMN     "portal_id" UUID,
ADD COLUMN     "sender_email" VARCHAR(254),
ADD COLUMN     "sender_name" VARCHAR(120),
ADD COLUMN     "sender_note" VARCHAR(255),
ADD COLUMN     "sender_reg_no" VARCHAR(20),
ADD COLUMN     "source" VARCHAR(40) DEFAULT 'manual';

-- CreateTable
CREATE TABLE "int_portal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "token" VARCHAR(64),
    "public_url" VARCHAR(200),
    "title" VARCHAR(255),
    "intro" TEXT,
    "allow_invoice" BOOLEAN NOT NULL DEFAULT true,
    "allow_advance" BOOLEAN NOT NULL DEFAULT true,
    "allow_order" BOOLEAN NOT NULL DEFAULT true,
    "allow_other" BOOLEAN NOT NULL DEFAULT true,
    "require_reg_no" BOOLEAN NOT NULL DEFAULT true,
    "auto_extract" BOOLEAN NOT NULL DEFAULT true,
    "max_file_mb" INTEGER DEFAULT 10,
    "max_files" INTEGER DEFAULT 5,
    "ip_hour_limit" INTEGER DEFAULT 10,
    "daily_limit" INTEGER DEFAULT 100,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "int_portal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "int_portal_upload" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "portal_id" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "reason" VARCHAR(255),
    "file_name" VARCHAR(255),
    "size" INTEGER,
    "ip_hash" VARCHAR(64),
    "sender_name" VARCHAR(120),
    "sender_reg_no" VARCHAR(20),
    "document_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "int_portal_upload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "int_portal_tenant_id_company_id_idx" ON "int_portal"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "int_portal_upload_tenant_id_company_id_idx" ON "int_portal_upload"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "int_portal_upload_portal_id_idx" ON "int_portal_upload"("portal_id");

-- CreateIndex
CREATE INDEX "int_portal_upload_document_id_idx" ON "int_portal_upload"("document_id");

-- CreateIndex
CREATE INDEX "int_document_portal_id_idx" ON "int_document"("portal_id");

-- AddForeignKey
ALTER TABLE "int_portal" ADD CONSTRAINT "int_portal_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_portal_upload" ADD CONSTRAINT "int_portal_upload_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_portal_upload" ADD CONSTRAINT "int_portal_upload_portal_id_fkey" FOREIGN KEY ("portal_id") REFERENCES "int_portal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_portal_upload" ADD CONSTRAINT "int_portal_upload_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "int_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_document" ADD CONSTRAINT "int_document_portal_id_fkey" FOREIGN KEY ("portal_id") REFERENCES "int_portal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
