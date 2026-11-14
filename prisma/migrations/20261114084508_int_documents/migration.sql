-- AlterTable
ALTER TABLE "int_connection" ADD COLUMN     "auto_list" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "daily_limit" INTEGER DEFAULT 50,
ADD COLUMN     "model" VARCHAR(60);

-- CreateTable
CREATE TABLE "int_document" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "doc_num" VARCHAR(20) NOT NULL,
    "file_name" VARCHAR(255),
    "target" VARCHAR(40) NOT NULL DEFAULT 'auto',
    "status" VARCHAR(40) NOT NULL DEFAULT 'new',
    "doc_type" VARCHAR(40),
    "partner_name" VARCHAR(120),
    "reg_no" VARCHAR(12),
    "vat_id" VARCHAR(16),
    "bank_account" VARCHAR(60),
    "subject_id" UUID,
    "vendor_id" UUID,
    "customer_id" UUID,
    "doc_number" VARCHAR(40),
    "order_number" VARCHAR(40),
    "issue_date" DATE,
    "tax_date" DATE,
    "due_date" DATE,
    "vs" VARCHAR(10),
    "currency_code" VARCHAR(10),
    "amount_net" DECIMAL(18,2),
    "tax_amount" DECIMAL(18,2),
    "amount_gross" DECIMAL(18,2),
    "message" VARCHAR(255),
    "connection_id" UUID,
    "result_object" VARCHAR(40),
    "result_id" VARCHAR(36),
    "result_title" VARCHAR(255),
    "raw" TEXT,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "int_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "int_document_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "line_num" INTEGER,
    "description" VARCHAR(255) NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unit" VARCHAR(10),
    "unit_price" DECIMAL(18,2),
    "tax_rate" DECIMAL(7,4),
    "amount_net" DECIMAL(18,2),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "int_document_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "int_document_tenant_id_company_id_idx" ON "int_document"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "int_document_subject_id_idx" ON "int_document"("subject_id");

-- CreateIndex
CREATE INDEX "int_document_vendor_id_idx" ON "int_document"("vendor_id");

-- CreateIndex
CREATE INDEX "int_document_customer_id_idx" ON "int_document"("customer_id");

-- CreateIndex
CREATE INDEX "int_document_connection_id_idx" ON "int_document"("connection_id");

-- CreateIndex
CREATE INDEX "int_document_line_tenant_id_company_id_idx" ON "int_document_line"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "int_document_line_document_id_idx" ON "int_document_line"("document_id");

-- AddForeignKey
ALTER TABLE "int_document" ADD CONSTRAINT "int_document_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_document" ADD CONSTRAINT "int_document_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "gab_subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_document" ADD CONSTRAINT "int_document_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "ap_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_document" ADD CONSTRAINT "int_document_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "ar_customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_document" ADD CONSTRAINT "int_document_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "int_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_document_line" ADD CONSTRAINT "int_document_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_document_line" ADD CONSTRAINT "int_document_line_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "int_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
