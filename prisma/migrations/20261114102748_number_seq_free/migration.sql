-- AlterTable
ALTER TABLE "sys_number_seq" ADD COLUMN     "continuous" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "sys_number_seq_free" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "seq_id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sys_number_seq_free_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sys_number_seq_free_tenant_id_company_id_idx" ON "sys_number_seq_free"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "sys_number_seq_free_seq_id_idx" ON "sys_number_seq_free"("seq_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_number_seq_free_tenant_id_company_id_seq_id_number_key" ON "sys_number_seq_free"("tenant_id", "company_id", "seq_id", "number");

-- AddForeignKey
ALTER TABLE "sys_number_seq_free" ADD CONSTRAINT "sys_number_seq_free_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_number_seq_free" ADD CONSTRAINT "sys_number_seq_free_seq_id_fkey" FOREIGN KEY ("seq_id") REFERENCES "sys_number_seq"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
