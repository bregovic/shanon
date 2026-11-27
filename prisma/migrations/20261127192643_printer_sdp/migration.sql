-- AlterTable
ALTER TABLE "int_connection" ADD COLUMN     "sdp_hash" VARCHAR(64),
ADD COLUMN     "sdp_seen_at" TIMESTAMP(3),
ADD COLUMN     "sdp_url" VARCHAR(300);

-- CreateTable
CREATE TABLE "int_net_print_job" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "reference" VARCHAR(255),
    "job_key" VARCHAR(30),
    "data" TEXT,
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

    CONSTRAINT "int_net_print_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "int_net_print_job_tenant_id_company_id_idx" ON "int_net_print_job"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "int_net_print_job_connection_id_idx" ON "int_net_print_job"("connection_id");

-- CreateIndex
CREATE INDEX "int_net_print_job_tenant_id_company_id_connection_id_status_idx" ON "int_net_print_job"("tenant_id", "company_id", "connection_id", "status");

-- CreateIndex
CREATE INDEX "int_net_print_job_tenant_id_company_id_connection_id_job_ke_idx" ON "int_net_print_job"("tenant_id", "company_id", "connection_id", "job_key");

-- AddForeignKey
ALTER TABLE "int_net_print_job" ADD CONSTRAINT "int_net_print_job_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_net_print_job" ADD CONSTRAINT "int_net_print_job_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "int_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
