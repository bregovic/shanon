-- AlterTable
ALTER TABLE "sys_user" ADD COLUMN     "invite_expires_at" TIMESTAMP(3),
ADD COLUMN     "invite_token_hash" VARCHAR(64),
ADD COLUMN     "invited_at" TIMESTAMP(3),
ADD COLUMN     "password_set_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "qa_feedback" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "feedback_num" VARCHAR(20) NOT NULL,
    "kind" VARCHAR(40) NOT NULL DEFAULT 'idea',
    "title" VARCHAR(255) NOT NULL,
    "text" TEXT,
    "feature_id" UUID,
    "page" VARCHAR(300),
    "status" VARCHAR(40) NOT NULL DEFAULT 'new',
    "author" VARCHAR(120),
    "posted_at" DATE,
    "issue_id" UUID,
    "reply" TEXT,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "qa_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qa_feedback_tenant_id_idx" ON "qa_feedback"("tenant_id");

-- CreateIndex
CREATE INDEX "qa_feedback_feature_id_idx" ON "qa_feedback"("feature_id");

-- CreateIndex
CREATE INDEX "qa_feedback_issue_id_idx" ON "qa_feedback"("issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "qa_feedback_tenant_id_feedback_num_key" ON "qa_feedback"("tenant_id", "feedback_num");

-- AddForeignKey
ALTER TABLE "qa_feedback" ADD CONSTRAINT "qa_feedback_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "qa_feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_feedback" ADD CONSTRAINT "qa_feedback_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "qa_issue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
