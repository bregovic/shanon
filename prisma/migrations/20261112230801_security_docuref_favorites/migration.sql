-- AlterTable
ALTER TABLE "sys_user" ADD COLUMN     "role_ids" UUID[] DEFAULT ARRAY[]::UUID[];

-- CreateTable
CREATE TABLE "sys_docuref" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "object_id" VARCHAR(60) NOT NULL,
    "record_id" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "note" TEXT,
    "mime" VARCHAR(120),
    "size" INTEGER,
    "storage" VARCHAR(10),
    "storage_key" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "sys_docuref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_file_blob" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "sys_file_blob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_favorite" (
    "user_id" UUID NOT NULL,
    "href" VARCHAR(255) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_favorite_pkey" PRIMARY KEY ("user_id","href")
);

-- CreateTable
CREATE TABLE "sys_role" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sys_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_role_permission" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "target" VARCHAR(40) NOT NULL,
    "level" VARCHAR(40) NOT NULL DEFAULT 'read',
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sys_role_permission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sys_docuref_tenant_id_object_id_record_id_idx" ON "sys_docuref"("tenant_id", "object_id", "record_id");

-- CreateIndex
CREATE INDEX "sys_file_blob_tenant_id_idx" ON "sys_file_blob"("tenant_id");

-- CreateIndex
CREATE INDEX "sys_role_tenant_id_idx" ON "sys_role"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_role_tenant_id_code_key" ON "sys_role"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "sys_role_permission_tenant_id_idx" ON "sys_role_permission"("tenant_id");

-- CreateIndex
CREATE INDEX "sys_role_permission_role_id_idx" ON "sys_role_permission"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_role_permission_tenant_id_role_id_target_key" ON "sys_role_permission"("tenant_id", "role_id", "target");

-- AddForeignKey
ALTER TABLE "sys_favorite" ADD CONSTRAINT "sys_favorite_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_role_permission" ADD CONSTRAINT "sys_role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "sys_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
