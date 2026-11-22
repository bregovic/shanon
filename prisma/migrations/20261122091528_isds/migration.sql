-- AlterTable
ALTER TABLE "tax_parameters" ADD COLUMN     "tax_office_data_box" VARCHAR(7);

-- AlterTable
ALTER TABLE "tax_return" ADD COLUMN     "isds_message_id" VARCHAR(20),
ADD COLUMN     "sent_at" DATE;

-- AlterTable
ALTER TABLE "int_connection" ADD COLUMN     "isds_login" VARCHAR(60),
ADD COLUMN     "isds_password" VARCHAR(4000);
