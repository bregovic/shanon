-- AlterTable
ALTER TABLE "sys_role" ADD COLUMN     "home_href" VARCHAR(200);

-- AlterTable
ALTER TABLE "ap_invoice" ADD COLUMN     "payment_state" VARCHAR(40) NOT NULL DEFAULT 'toPay';

-- AlterTable
ALTER TABLE "int_document" ADD COLUMN     "payment_state" VARCHAR(40) NOT NULL DEFAULT 'toPay';
