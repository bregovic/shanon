-- AlterTable
ALTER TABLE "org_entity" ADD COLUMN     "mail_advance_body" TEXT,
ADD COLUMN     "mail_advance_subject" VARCHAR(255),
ADD COLUMN     "mail_invoice_body" TEXT,
ADD COLUMN     "mail_invoice_subject" VARCHAR(255),
ADD COLUMN     "mail_receipt_body" TEXT,
ADD COLUMN     "mail_receipt_subject" VARCHAR(255),
ADD COLUMN     "mail_signature" TEXT;

-- AlterTable
ALTER TABLE "ar_invoice" ADD COLUMN     "emailed_to" VARCHAR(255);

-- AlterTable
ALTER TABLE "ap_invoice" ADD COLUMN     "emailed_to" VARCHAR(255);

-- AlterTable
ALTER TABLE "pos_receipt" ADD COLUMN     "emailed_at" TIMESTAMP(3),
ADD COLUMN     "emailed_to" VARCHAR(255);
