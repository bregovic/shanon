-- CreateTable
CREATE TABLE "tax_payment_term" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "days" INTEGER NOT NULL DEFAULT 0,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "tax_payment_term_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ar_group" ADD COLUMN     "payment_term_id" UUID;

-- AlterTable
ALTER TABLE "ar_customer" ADD COLUMN     "payment_term_id" UUID;

-- AlterTable
ALTER TABLE "ap_group" ADD COLUMN     "payment_term_id" UUID;

-- AlterTable
ALTER TABLE "ap_vendor" ADD COLUMN     "payment_term_id" UUID;


-- Data: platební podmínky z dosavadních dnů splatnosti (výchozí 0 / 14 / 30 + další použité počty dní)
WITH used AS (
  SELECT tenant_id, company_id, payment_days AS days FROM "ar_group" WHERE payment_days IS NOT NULL
  UNION SELECT tenant_id, company_id, payment_days FROM "ar_customer" WHERE payment_days IS NOT NULL
  UNION SELECT tenant_id, company_id, payment_days FROM "ap_group" WHERE payment_days IS NOT NULL
  UNION SELECT tenant_id, company_id, payment_days FROM "ap_vendor" WHERE payment_days IS NOT NULL
), companies AS (
  SELECT tenant_id, company_id FROM "ar_group" UNION SELECT tenant_id, company_id FROM "ap_group"
  UNION SELECT tenant_id, company_id FROM "ar_customer" UNION SELECT tenant_id, company_id FROM "ap_vendor"
), terms AS (
  SELECT tenant_id, company_id, GREATEST(days, 0) AS days FROM used
  UNION SELECT c.tenant_id, c.company_id, d.days FROM companies c CROSS JOIN (VALUES (0), (14), (30)) AS d(days)
)
INSERT INTO "tax_payment_term" ("id", "tenant_id", "company_id", "code", "name", "days")
SELECT gen_random_uuid(), tenant_id, company_id, days::text, CASE WHEN days = 0 THEN 'Ihned' ELSE days::text || ' dní' END, days FROM terms;

UPDATE "ar_group" x SET payment_term_id = t.id FROM "tax_payment_term" t WHERE x.payment_days IS NOT NULL AND t.tenant_id = x.tenant_id AND t.company_id = x.company_id AND t.code = GREATEST(x.payment_days, 0)::text;
UPDATE "ar_customer" x SET payment_term_id = t.id FROM "tax_payment_term" t WHERE x.payment_days IS NOT NULL AND t.tenant_id = x.tenant_id AND t.company_id = x.company_id AND t.code = GREATEST(x.payment_days, 0)::text;
UPDATE "ap_group" x SET payment_term_id = t.id FROM "tax_payment_term" t WHERE x.payment_days IS NOT NULL AND t.tenant_id = x.tenant_id AND t.company_id = x.company_id AND t.code = GREATEST(x.payment_days, 0)::text;
UPDATE "ap_vendor" x SET payment_term_id = t.id FROM "tax_payment_term" t WHERE x.payment_days IS NOT NULL AND t.tenant_id = x.tenant_id AND t.company_id = x.company_id AND t.code = GREATEST(x.payment_days, 0)::text;

ALTER TABLE "ar_group" DROP COLUMN "payment_days";
ALTER TABLE "ar_customer" DROP COLUMN "payment_days";
ALTER TABLE "ap_group" DROP COLUMN "payment_days";
ALTER TABLE "ap_vendor" DROP COLUMN "payment_days";

-- CreateIndex
CREATE INDEX "tax_payment_term_tenant_id_company_id_idx" ON "tax_payment_term"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_payment_term_tenant_id_company_id_code_key" ON "tax_payment_term"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "ar_group_payment_term_id_idx" ON "ar_group"("payment_term_id");

-- CreateIndex
CREATE INDEX "ar_customer_payment_term_id_idx" ON "ar_customer"("payment_term_id");

-- CreateIndex
CREATE INDEX "ap_group_payment_term_id_idx" ON "ap_group"("payment_term_id");

-- CreateIndex
CREATE INDEX "ap_vendor_payment_term_id_idx" ON "ap_vendor"("payment_term_id");

-- AddForeignKey
ALTER TABLE "tax_payment_term" ADD CONSTRAINT "tax_payment_term_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_group" ADD CONSTRAINT "ar_group_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "tax_payment_term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_customer" ADD CONSTRAINT "ar_customer_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "tax_payment_term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_group" ADD CONSTRAINT "ap_group_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "tax_payment_term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_vendor" ADD CONSTRAINT "ap_vendor_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "tax_payment_term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
