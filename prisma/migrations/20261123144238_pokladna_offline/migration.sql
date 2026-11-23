-- AlterTable
ALTER TABLE "pos_receipt" ADD COLUMN     "client_id" VARCHAR(36),
ADD COLUMN     "offline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sold_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "pos_receipt_tenant_id_company_id_client_id_idx" ON "pos_receipt"("tenant_id", "company_id", "client_id");
