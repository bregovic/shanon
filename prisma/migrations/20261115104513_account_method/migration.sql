-- CreateTable
CREATE TABLE "bank_account_method" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "payment_method_id" UUID NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "bank_account_method_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_account_method_tenant_id_company_id_idx" ON "bank_account_method"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "bank_account_method_bank_account_id_idx" ON "bank_account_method"("bank_account_id");

-- CreateIndex
CREATE INDEX "bank_account_method_payment_method_id_idx" ON "bank_account_method"("payment_method_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_account_method_tenant_id_company_id_bank_account_id_pa_key" ON "bank_account_method"("tenant_id", "company_id", "bank_account_id", "payment_method_id");

-- AddForeignKey
ALTER TABLE "bank_account_method" ADD CONSTRAINT "bank_account_method_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account_method" ADD CONSTRAINT "bank_account_method_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account_method" ADD CONSTRAINT "bank_account_method_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "bank_payment_method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- dosavadní „bankovní účet na platební metodě“ → metoda přiřazená k účtu (výchozí)
INSERT INTO "bank_account_method" ("id", "tenant_id", "company_id", "bank_account_id", "payment_method_id", "is_default", "version", "created_at", "updated_at")
SELECT gen_random_uuid(), m."tenant_id", m."company_id", m."bank_account_id", m."id", true, 1, now(), now()
FROM "bank_payment_method" m WHERE m."bank_account_id" IS NOT NULL
ON CONFLICT DO NOTHING;
