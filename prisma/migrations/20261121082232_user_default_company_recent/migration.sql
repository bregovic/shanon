-- AlterTable
ALTER TABLE "sys_user" ADD COLUMN     "default_company_id" UUID;

-- CreateTable
CREATE TABLE "sys_recent" (
    "user_id" UUID NOT NULL,
    "href" VARCHAR(1000) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "module" VARCHAR(120) NOT NULL DEFAULT '',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_recent_pkey" PRIMARY KEY ("user_id","href")
);

-- CreateIndex
CREATE INDEX "sys_recent_user_id_opened_at_idx" ON "sys_recent"("user_id", "opened_at");

-- AddForeignKey
ALTER TABLE "sys_recent" ADD CONSTRAINT "sys_recent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
