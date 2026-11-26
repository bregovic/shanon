-- AlterTable
ALTER TABLE "int_portal" ADD COLUMN     "mail_agreement" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "int_form_field" ADD COLUMN     "show_if" VARCHAR(255);
