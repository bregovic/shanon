-- CreateTable
CREATE TABLE "sys_notification" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL DEFAULT 'info',
    "title" VARCHAR(120) NOT NULL,
    "params" TEXT,
    "message" VARCHAR(255),
    "href" VARCHAR(255),
    "key" VARCHAR(120),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sys_notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_notification_read" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "user_id" VARCHAR(36) NOT NULL,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sys_notification_read_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sys_notification_tenant_id_company_id_idx" ON "sys_notification"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "sys_notification_read_tenant_id_company_id_idx" ON "sys_notification_read"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "sys_notification_read_notification_id_idx" ON "sys_notification_read"("notification_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_notification_read_tenant_id_company_id_notification_id__key" ON "sys_notification_read"("tenant_id", "company_id", "notification_id", "user_id");

-- AddForeignKey
ALTER TABLE "sys_notification" ADD CONSTRAINT "sys_notification_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_notification_read" ADD CONSTRAINT "sys_notification_read_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_notification_read" ADD CONSTRAINT "sys_notification_read_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "sys_notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
