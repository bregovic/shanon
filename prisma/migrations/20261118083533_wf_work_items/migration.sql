-- AlterTable
ALTER TABLE "sys_notification" ADD COLUMN     "user_id" VARCHAR(36);

-- CreateTable
CREATE TABLE "wf_work_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(40) NOT NULL DEFAULT 'task',
    "status" VARCHAR(40) NOT NULL DEFAULT 'open',
    "assigned_to" VARCHAR(36),
    "due_date" DATE,
    "description" TEXT,
    "ref_object" VARCHAR(60),
    "ref_id" VARCHAR(36),
    "ref_title" VARCHAR(120),
    "href" VARCHAR(255),
    "source_key" VARCHAR(120),
    "result" VARCHAR(255),
    "completed_at" TIMESTAMP(3),
    "completed_by" VARCHAR(36),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "wf_work_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wf_work_item_tenant_id_company_id_idx" ON "wf_work_item"("tenant_id", "company_id");

-- AddForeignKey
ALTER TABLE "wf_work_item" ADD CONSTRAINT "wf_work_item_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
