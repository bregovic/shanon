-- AlterTable
ALTER TABLE "int_connection" ADD COLUMN     "copies" INTEGER DEFAULT 1,
ADD COLUMN     "device_id" UUID,
ADD COLUMN     "printer_name" VARCHAR(200);

-- CreateTable
CREATE TABLE "int_device" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "register_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "paired" BOOLEAN NOT NULL DEFAULT false,
    "last_seen_at" TIMESTAMP(3),
    "host_name" VARCHAR(120),
    "agent_version" VARCHAR(40),
    "printers" TEXT,
    "token_hash" VARCHAR(64),
    "pair_hash" VARCHAR(64),
    "pair_expires" TIMESTAMP(3),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "int_device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "int_print_route" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "doc_type" VARCHAR(40) NOT NULL,
    "user_id" VARCHAR(36),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "int_print_route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "int_print_job" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "doc_type" VARCHAR(40),
    "record_id" VARCHAR(36),
    "template_id" VARCHAR(36),
    "reference" VARCHAR(255),
    "copies" INTEGER DEFAULT 1,
    "status" VARCHAR(40) NOT NULL DEFAULT 'queued',
    "message" VARCHAR(255),
    "sent_at" TIMESTAMP(3),
    "done_at" TIMESTAMP(3),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "int_print_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "int_device_tenant_id_company_id_idx" ON "int_device"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "int_device_register_id_idx" ON "int_device"("register_id");

-- CreateIndex
CREATE UNIQUE INDEX "int_device_tenant_id_company_id_code_key" ON "int_device"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "int_print_route_tenant_id_company_id_idx" ON "int_print_route"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "int_print_route_connection_id_idx" ON "int_print_route"("connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "int_print_route_tenant_id_company_id_connection_id_doc_type_key" ON "int_print_route"("tenant_id", "company_id", "connection_id", "doc_type", "user_id");

-- CreateIndex
CREATE INDEX "int_print_job_tenant_id_company_id_idx" ON "int_print_job"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "int_print_job_device_id_idx" ON "int_print_job"("device_id");

-- CreateIndex
CREATE INDEX "int_print_job_connection_id_idx" ON "int_print_job"("connection_id");

-- CreateIndex
CREATE INDEX "int_print_job_tenant_id_company_id_device_id_status_idx" ON "int_print_job"("tenant_id", "company_id", "device_id", "status");

-- CreateIndex
CREATE INDEX "int_connection_device_id_idx" ON "int_connection"("device_id");

-- AddForeignKey
ALTER TABLE "int_connection" ADD CONSTRAINT "int_connection_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "int_device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_device" ADD CONSTRAINT "int_device_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_device" ADD CONSTRAINT "int_device_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "pos_register"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_print_route" ADD CONSTRAINT "int_print_route_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_print_route" ADD CONSTRAINT "int_print_route_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "int_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_print_job" ADD CONSTRAINT "int_print_job_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_print_job" ADD CONSTRAINT "int_print_job_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "int_device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_print_job" ADD CONSTRAINT "int_print_job_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "int_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
