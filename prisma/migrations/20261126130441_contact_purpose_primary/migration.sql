-- AlterTable
ALTER TABLE "gab_contact" ADD COLUMN     "is_primary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "purpose" VARCHAR(40) DEFAULT 'business';

-- CreateIndex
CREATE INDEX "gab_contact_tenant_id_company_id_subject_id_kind_idx" ON "gab_contact"("tenant_id", "company_id", "subject_id", "kind");
