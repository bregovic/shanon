-- AlterTable
ALTER TABLE "ar_customer" ADD COLUMN     "doc_email" VARCHAR(254);

-- AlterTable
ALTER TABLE "ar_invoice" ADD COLUMN     "emailed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ap_vendor" ADD COLUMN     "doc_email" VARCHAR(254);

-- AlterTable
ALTER TABLE "ap_invoice" ADD COLUMN     "emailed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "int_connection" ADD COLUMN     "bcc_self" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "from_email" VARCHAR(254),
ADD COLUMN     "from_name" VARCHAR(120),
ADD COLUMN     "reply_to" VARCHAR(254),
ADD COLUMN     "signature" TEXT,
ADD COLUMN     "smtp_host" VARCHAR(200),
ADD COLUMN     "smtp_password" VARCHAR(4000),
ADD COLUMN     "smtp_port" INTEGER DEFAULT 587,
ADD COLUMN     "smtp_security" VARCHAR(40) DEFAULT 'starttls',
ADD COLUMN     "smtp_user" VARCHAR(200);

-- CreateTable
CREATE TABLE "int_mail" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "mail_to" VARCHAR(500),
    "mail_cc" VARCHAR(500),
    "subject" VARCHAR(250) NOT NULL,
    "body" TEXT,
    "status" VARCHAR(40) NOT NULL DEFAULT 'draft',
    "connection_id" UUID,
    "reference" VARCHAR(255),
    "source_object" VARCHAR(40),
    "source_id" VARCHAR(36),
    "sent_at" TIMESTAMP(3),
    "message_id" VARCHAR(255),
    "error" VARCHAR(255),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "int_mail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "int_mail_tenant_id_company_id_idx" ON "int_mail"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "int_mail_connection_id_idx" ON "int_mail"("connection_id");

-- AddForeignKey
ALTER TABLE "int_mail" ADD CONSTRAINT "int_mail_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "int_mail" ADD CONSTRAINT "int_mail_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "int_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
