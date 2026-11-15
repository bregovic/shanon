-- AlterTable
ALTER TABLE "sys_currency" ADD COLUMN     "invoice_rounding_unit" DECIMAL(10,4) NOT NULL DEFAULT 0.01;

-- AlterTable
ALTER TABLE "ar_invoice" ADD COLUMN     "rounding_amount" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "ap_invoice" ADD COLUMN     "rounding_amount" DECIMAL(18,2);

-- koruny: faktury na celé koruny (výchozí nastavení CZK)
UPDATE "sys_currency" SET "invoice_rounding_unit" = '1' WHERE "code" = 'CZK';
