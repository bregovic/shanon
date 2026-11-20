-- AlterTable
ALTER TABLE "wf_work_item" ADD COLUMN     "instance_id" UUID,
ADD COLUMN     "step_num" INTEGER;

-- CreateTable
CREATE TABLE "wf_participant_type" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "user_id" VARCHAR(36),
    "description" VARCHAR(255),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "wf_participant_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wf_definition" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "object_id" VARCHAR(60) NOT NULL,
    "trigger" VARCHAR(40) NOT NULL DEFAULT 'created',
    "trigger_name" VARCHAR(40),
    "condition" VARCHAR(500),
    "lock_actions" VARCHAR(120),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "wf_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wf_definition_step" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "line_num" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(40) NOT NULL DEFAULT 'approval',
    "action" VARCHAR(40),
    "check_action" VARCHAR(40),
    "precondition" VARCHAR(500),
    "condition" VARCHAR(500),
    "assign_to" VARCHAR(40) NOT NULL DEFAULT 'originator',
    "participant_type_id" UUID,
    "user_id" VARCHAR(36),
    "due_days" INTEGER,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "wf_definition_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wf_instance" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "ref_object" VARCHAR(60),
    "ref_id" VARCHAR(36),
    "ref_title" VARCHAR(120),
    "href" VARCHAR(255),
    "status" VARCHAR(40) NOT NULL DEFAULT 'running',
    "step_num" INTEGER,
    "step_name" VARCHAR(120),
    "message" VARCHAR(255),
    "completed_at" TIMESTAMP(3),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "wf_instance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wf_participant_type_tenant_id_company_id_idx" ON "wf_participant_type"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "wf_participant_type_tenant_id_company_id_code_key" ON "wf_participant_type"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "wf_definition_tenant_id_company_id_idx" ON "wf_definition"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "wf_definition_tenant_id_company_id_code_key" ON "wf_definition"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "wf_definition_step_tenant_id_company_id_idx" ON "wf_definition_step"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "wf_definition_step_definition_id_idx" ON "wf_definition_step"("definition_id");

-- CreateIndex
CREATE INDEX "wf_definition_step_participant_type_id_idx" ON "wf_definition_step"("participant_type_id");

-- CreateIndex
CREATE INDEX "wf_instance_tenant_id_company_id_idx" ON "wf_instance"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "wf_instance_definition_id_idx" ON "wf_instance"("definition_id");

-- CreateIndex
CREATE INDEX "wf_instance_tenant_id_company_id_ref_object_ref_id_status_idx" ON "wf_instance"("tenant_id", "company_id", "ref_object", "ref_id", "status");

-- CreateIndex
CREATE INDEX "wf_work_item_instance_id_idx" ON "wf_work_item"("instance_id");

-- CreateIndex
CREATE INDEX "wf_work_item_tenant_id_company_id_instance_id_idx" ON "wf_work_item"("tenant_id", "company_id", "instance_id");

-- AddForeignKey
ALTER TABLE "wf_work_item" ADD CONSTRAINT "wf_work_item_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "wf_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wf_participant_type" ADD CONSTRAINT "wf_participant_type_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wf_definition" ADD CONSTRAINT "wf_definition_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wf_definition_step" ADD CONSTRAINT "wf_definition_step_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wf_definition_step" ADD CONSTRAINT "wf_definition_step_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "wf_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wf_definition_step" ADD CONSTRAINT "wf_definition_step_participant_type_id_fkey" FOREIGN KEY ("participant_type_id") REFERENCES "wf_participant_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wf_instance" ADD CONSTRAINT "wf_instance_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wf_instance" ADD CONSTRAINT "wf_instance_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "wf_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
