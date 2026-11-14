-- AlterTable
ALTER TABLE "gab_subject" ADD COLUMN     "tax_office" VARCHAR(10),
ADD COLUMN     "vat_checked_at" DATE,
ADD COLUMN     "vat_reliability" VARCHAR(40);

-- AlterTable
ALTER TABLE "ar_customer" ADD COLUMN     "bank_account_id" UUID;

-- AlterTable
ALTER TABLE "ap_vendor" ADD COLUMN     "bank_account_id" UUID;

-- CreateTable
CREATE TABLE "gab_bank_account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "account_num" VARCHAR(30),
    "iban" VARCHAR(34),
    "bic" VARCHAR(11),
    "currency_id" UUID,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" DATE,
    "source" VARCHAR(40) DEFAULT 'manual',
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "gab_bank_account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gab_bank_account_tenant_id_company_id_idx" ON "gab_bank_account"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "gab_bank_account_subject_id_idx" ON "gab_bank_account"("subject_id");

-- CreateIndex
CREATE INDEX "gab_bank_account_currency_id_idx" ON "gab_bank_account"("currency_id");

-- CreateIndex
CREATE INDEX "ar_customer_bank_account_id_idx" ON "ar_customer"("bank_account_id");

-- CreateIndex
CREATE INDEX "ap_vendor_bank_account_id_idx" ON "ap_vendor"("bank_account_id");

-- AddForeignKey
ALTER TABLE "gab_bank_account" ADD CONSTRAINT "gab_bank_account_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gab_bank_account" ADD CONSTRAINT "gab_bank_account_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "gab_subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gab_bank_account" ADD CONSTRAINT "gab_bank_account_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_customer" ADD CONSTRAINT "ar_customer_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "gab_bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_vendor" ADD CONSTRAINT "ap_vendor_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "gab_bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
