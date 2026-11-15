-- AlterTable
ALTER TABLE "qa_issue" ADD COLUMN     "parent_id" UUID;

-- CreateTable
CREATE TABLE "qa_issue_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "line_num" INTEGER,
    "text" VARCHAR(255) NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'todo',
    "fixed_at" DATE,
    "checked_at" DATE,
    "note" VARCHAR(255),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "qa_issue_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qa_issue_item_tenant_id_idx" ON "qa_issue_item"("tenant_id");

-- CreateIndex
CREATE INDEX "qa_issue_item_issue_id_idx" ON "qa_issue_item"("issue_id");

-- CreateIndex
CREATE INDEX "qa_issue_parent_id_idx" ON "qa_issue"("parent_id");

-- AddForeignKey
ALTER TABLE "qa_issue" ADD CONSTRAINT "qa_issue_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "qa_issue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_issue_item" ADD CONSTRAINT "qa_issue_item_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "qa_issue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
