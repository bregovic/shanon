-- CreateTable
CREATE TABLE "qa_changelog" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "released_at" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" VARCHAR(40) NOT NULL DEFAULT 'feature',
    "area" VARCHAR(60),
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT,
    "issue_id" UUID,
    "commit" VARCHAR(40),
    "published" BOOLEAN NOT NULL DEFAULT true,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "qa_changelog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qa_changelog_tenant_id_idx" ON "qa_changelog"("tenant_id");

-- CreateIndex
CREATE INDEX "qa_changelog_issue_id_idx" ON "qa_changelog"("issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "qa_changelog_tenant_id_released_at_title_key" ON "qa_changelog"("tenant_id", "released_at", "title");

-- AddForeignKey
ALTER TABLE "qa_changelog" ADD CONSTRAINT "qa_changelog_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "qa_issue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
