-- CreateTable
CREATE TABLE "sys_batch_job" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "job_class" VARCHAR(40) NOT NULL,
    "recurrence" VARCHAR(40) NOT NULL DEFAULT 'days',
    "every" INTEGER DEFAULT 1,
    "next_run_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(40) DEFAULT 'waiting',
    "last_run_at" TIMESTAMP(3),
    "last_message" VARCHAR(255),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sys_batch_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_batch_run" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "status" VARCHAR(40),
    "message" VARCHAR(255),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sys_batch_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sys_batch_job_tenant_id_company_id_idx" ON "sys_batch_job"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_batch_job_tenant_id_company_id_code_key" ON "sys_batch_job"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "sys_batch_run_tenant_id_company_id_idx" ON "sys_batch_run"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "sys_batch_run_job_id_idx" ON "sys_batch_run"("job_id");

-- AddForeignKey
ALTER TABLE "sys_batch_job" ADD CONSTRAINT "sys_batch_job_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_batch_run" ADD CONSTRAINT "sys_batch_run_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_batch_run" ADD CONSTRAINT "sys_batch_run_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "sys_batch_job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
