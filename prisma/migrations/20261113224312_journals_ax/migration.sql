-- AlterTable
ALTER TABLE "gl_journal_name" ADD COLUMN     "journal_type" VARCHAR(40) NOT NULL DEFAULT 'daily',
ADD COLUMN     "offset_bank_account_id" UUID,
ADD COLUMN     "offset_cash_desk_id" UUID,
ADD COLUMN     "offset_type" VARCHAR(40),
ADD COLUMN     "voucher_allocation" VARCHAR(40) NOT NULL DEFAULT 'balance';

-- AlterTable
ALTER TABLE "gl_journal" ADD COLUMN     "check_result" VARCHAR(255);

-- AlterTable
ALTER TABLE "gl_journal_line" ADD COLUMN     "account_type" VARCHAR(40) NOT NULL DEFAULT 'ledger',
ADD COLUMN     "bank_account_id" UUID,
ADD COLUMN     "cash_desk_id" UUID,
ADD COLUMN     "customer_id" UUID,
ADD COLUMN     "date" DATE,
ADD COLUMN     "line_num" INTEGER,
ADD COLUMN     "offset_account_id" UUID,
ADD COLUMN     "offset_bank_account_id" UUID,
ADD COLUMN     "offset_cash_desk_id" UUID,
ADD COLUMN     "offset_customer_id" UUID,
ADD COLUMN     "offset_type" VARCHAR(40),
ADD COLUMN     "offset_vendor_id" UUID,
ADD COLUMN     "vendor_id" UUID,
ADD COLUMN     "voucher_num" VARCHAR(20),
ADD COLUMN     "vs" VARCHAR(10),
ALTER COLUMN "account_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "gl_journal_name_offset_bank_account_id_idx" ON "gl_journal_name"("offset_bank_account_id");

-- CreateIndex
CREATE INDEX "gl_journal_name_offset_cash_desk_id_idx" ON "gl_journal_name"("offset_cash_desk_id");

-- CreateIndex
CREATE INDEX "gl_journal_line_customer_id_idx" ON "gl_journal_line"("customer_id");

-- CreateIndex
CREATE INDEX "gl_journal_line_vendor_id_idx" ON "gl_journal_line"("vendor_id");

-- CreateIndex
CREATE INDEX "gl_journal_line_bank_account_id_idx" ON "gl_journal_line"("bank_account_id");

-- CreateIndex
CREATE INDEX "gl_journal_line_cash_desk_id_idx" ON "gl_journal_line"("cash_desk_id");

-- CreateIndex
CREATE INDEX "gl_journal_line_offset_account_id_idx" ON "gl_journal_line"("offset_account_id");

-- CreateIndex
CREATE INDEX "gl_journal_line_offset_customer_id_idx" ON "gl_journal_line"("offset_customer_id");

-- CreateIndex
CREATE INDEX "gl_journal_line_offset_vendor_id_idx" ON "gl_journal_line"("offset_vendor_id");

-- CreateIndex
CREATE INDEX "gl_journal_line_offset_bank_account_id_idx" ON "gl_journal_line"("offset_bank_account_id");

-- CreateIndex
CREATE INDEX "gl_journal_line_offset_cash_desk_id_idx" ON "gl_journal_line"("offset_cash_desk_id");

-- AddForeignKey
ALTER TABLE "gl_journal_name" ADD CONSTRAINT "gl_journal_name_offset_bank_account_id_fkey" FOREIGN KEY ("offset_bank_account_id") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_name" ADD CONSTRAINT "gl_journal_name_offset_cash_desk_id_fkey" FOREIGN KEY ("offset_cash_desk_id") REFERENCES "cash_desk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_line" ADD CONSTRAINT "gl_journal_line_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "ar_customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_line" ADD CONSTRAINT "gl_journal_line_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "ap_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_line" ADD CONSTRAINT "gl_journal_line_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_line" ADD CONSTRAINT "gl_journal_line_cash_desk_id_fkey" FOREIGN KEY ("cash_desk_id") REFERENCES "cash_desk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_line" ADD CONSTRAINT "gl_journal_line_offset_account_id_fkey" FOREIGN KEY ("offset_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_line" ADD CONSTRAINT "gl_journal_line_offset_customer_id_fkey" FOREIGN KEY ("offset_customer_id") REFERENCES "ar_customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_line" ADD CONSTRAINT "gl_journal_line_offset_vendor_id_fkey" FOREIGN KEY ("offset_vendor_id") REFERENCES "ap_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_line" ADD CONSTRAINT "gl_journal_line_offset_bank_account_id_fkey" FOREIGN KEY ("offset_bank_account_id") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_journal_line" ADD CONSTRAINT "gl_journal_line_offset_cash_desk_id_fkey" FOREIGN KEY ("offset_cash_desk_id") REFERENCES "cash_desk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data: stávající protiúčet názvu deníku = druh Hlavní kniha
UPDATE "gl_journal_name" SET "offset_type" = 'ledger' WHERE "offset_account_id" IS NOT NULL AND "offset_type" IS NULL;
-- Data: pořadí stávajících řádků deníků
UPDATE "gl_journal_line" l SET "line_num" = x.n
FROM (SELECT "id", row_number() OVER (PARTITION BY "journal_id" ORDER BY "created_at", "id") AS n FROM "gl_journal_line") x
WHERE l."id" = x."id" AND l."line_num" IS NULL;
