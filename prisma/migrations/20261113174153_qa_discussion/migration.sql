-- CreateTable
CREATE TABLE "qa_comment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "author" VARCHAR(120),
    "posted_at" DATE,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "qa_comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qa_comment_tenant_id_idx" ON "qa_comment"("tenant_id");

-- CreateIndex
CREATE INDEX "qa_comment_issue_id_idx" ON "qa_comment"("issue_id");

-- AddForeignKey
ALTER TABLE "qa_comment" ADD CONSTRAINT "qa_comment_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "qa_issue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
