-- AlterTable
ALTER TABLE "pos_receipt" ADD COLUMN     "eet_message" VARCHAR(255),
ADD COLUMN     "eet_pok" VARCHAR(255),
ADD COLUMN     "eet_status" VARCHAR(40),
ADD COLUMN     "payment_ref" VARCHAR(255);

-- CreateTable
CREATE TABLE "int_connection" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(40) NOT NULL DEFAULT 'eet',
    "driver" VARCHAR(40) NOT NULL DEFAULT 'eet2',
    "register_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "environment" VARCHAR(40) DEFAULT 'playground',
    "unit_id" VARCHAR(9),
    "pos_id" VARCHAR(20),
    "cert_password" VARCHAR(4000),
    "cert_data" TEXT,
    "cert_subject" VARCHAR(255),
    "cert_valid_to" DATE,
    "paper_width" VARCHAR(40) DEFAULT '80',
    "code_page" VARCHAR(40) DEFAULT 'cp852',
    "baud_rate" INTEGER DEFAULT 9600,
    "open_drawer" BOOLEAN NOT NULL DEFAULT false,
    "auto_print" BOOLEAN NOT NULL DEFAULT false,
    "merchant_code" VARCHAR(20),
    "api_key" VARCHAR(4000),
    "affiliate_app_id" VARCHAR(120),
    "affiliate_key" VARCHAR(4000),
    "pairing_code" VARCHAR(20),
    "reader_id" VARCHAR(60),
    "last_check_at" DATE,
    "last_result" VARCHAR(255),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "int_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "int_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "operation" VARCHAR(40) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "reference" VARCHAR(255),
    "external_id" VARCHAR(255),
    "message" VARCHAR(255),
    "detail" TEXT,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "int_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "int_connection_tenant_id_company_id_idx" ON "int_connection"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "int_connection_register_id_idx" ON "int_connection"("register_id");

-- CreateIndex
CREATE UNIQUE INDEX "int_connection_tenant_id_company_id_code_key" ON "int_connection"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "int_log_tenant_id_company_id_idx" ON "int_log"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "int_log_connection_id_idx" ON "int_log"("connection_id");

-- AddForeignKey
ALTER TABLE "int_connection" ADD CONSTRAINT "int_connection_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_connection" ADD CONSTRAINT "int_connection_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "pos_register"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_log" ADD CONSTRAINT "int_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_log" ADD CONSTRAINT "int_log_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "int_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
