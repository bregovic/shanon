-- CreateTable
CREATE TABLE "qa_feature" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "area" VARCHAR(60),
    "status" VARCHAR(40) NOT NULL DEFAULT 'planned',
    "owner" VARCHAR(120),
    "description" TEXT,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "qa_feature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_scenario" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "feature_id" UUID NOT NULL,
    "stage" VARCHAR(40) NOT NULL DEFAULT 'fat',
    "steps" TEXT,
    "expected" TEXT,
    "result" VARCHAR(40) NOT NULL DEFAULT 'notRun',
    "tested_at" DATE,
    "tester" VARCHAR(120),
    "note" TEXT,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "qa_scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_issue" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "issue_num" VARCHAR(20) NOT NULL,
    "type" VARCHAR(40) NOT NULL DEFAULT 'change',
    "title" VARCHAR(255) NOT NULL,
    "feature_id" UUID,
    "scenario_id" UUID,
    "priority" VARCHAR(40) NOT NULL DEFAULT 'medium',
    "status" VARCHAR(40) NOT NULL DEFAULT 'new',
    "order" INTEGER,
    "reported_by" VARCHAR(120),
    "assigned_to" VARCHAR(120),
    "due_date" DATE,
    "description" TEXT,
    "resolution" TEXT,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "qa_issue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qa_feature_tenant_id_idx" ON "qa_feature"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "qa_feature_tenant_id_code_key" ON "qa_feature"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "qa_scenario_tenant_id_idx" ON "qa_scenario"("tenant_id");

-- CreateIndex
CREATE INDEX "qa_scenario_feature_id_idx" ON "qa_scenario"("feature_id");

-- CreateIndex
CREATE UNIQUE INDEX "qa_scenario_tenant_id_code_key" ON "qa_scenario"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "qa_issue_tenant_id_idx" ON "qa_issue"("tenant_id");

-- CreateIndex
CREATE INDEX "qa_issue_feature_id_idx" ON "qa_issue"("feature_id");

-- CreateIndex
CREATE INDEX "qa_issue_scenario_id_idx" ON "qa_issue"("scenario_id");

-- CreateIndex
CREATE UNIQUE INDEX "qa_issue_tenant_id_issue_num_key" ON "qa_issue"("tenant_id", "issue_num");

-- AddForeignKey
ALTER TABLE "qa_scenario" ADD CONSTRAINT "qa_scenario_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "qa_feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_issue" ADD CONSTRAINT "qa_issue_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "qa_feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_issue" ADD CONSTRAINT "qa_issue_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "qa_scenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
