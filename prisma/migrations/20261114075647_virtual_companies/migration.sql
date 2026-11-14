-- DropIndex
DROP INDEX "gab_subject_tenant_id_idx";

-- DropIndex
DROP INDEX "gab_address_tenant_id_idx";

-- DropIndex
DROP INDEX "gab_contact_tenant_id_idx";

-- DropIndex
DROP INDEX "gl_dimension_tenant_id_idx";

-- DropIndex
DROP INDEX "gl_dimension_tenant_id_code_key";

-- DropIndex
DROP INDEX "gl_dimension_tenant_id_position_key";

-- DropIndex
DROP INDEX "gl_dimension_value_tenant_id_idx";

-- DropIndex
DROP INDEX "gl_dimension_value_tenant_id_dimension_id_code_key";

-- AlterTable
ALTER TABLE "sys_company" ADD COLUMN     "virtual" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "gab_subject" ADD COLUMN     "company_id" UUID;

-- AlterTable
ALTER TABLE "gab_address" ADD COLUMN     "company_id" UUID;

-- AlterTable
ALTER TABLE "gab_contact" ADD COLUMN     "company_id" UUID;

-- AlterTable
ALTER TABLE "gl_dimension" ADD COLUMN     "company_id" UUID;

-- AlterTable
ALTER TABLE "gl_dimension_value" ADD COLUMN     "company_id" UUID;

-- CreateTable
CREATE TABLE "sys_virtual_company" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "holder_company_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sys_virtual_company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_virtual_member" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "virtual_company_id" UUID NOT NULL,
    "member_company_id" UUID NOT NULL,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sys_virtual_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_virtual_share" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "virtual_company_id" UUID NOT NULL,
    "object_id" VARCHAR(40) NOT NULL,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sys_virtual_share_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sys_virtual_company_tenant_id_idx" ON "sys_virtual_company"("tenant_id");

-- CreateIndex
CREATE INDEX "sys_virtual_company_holder_company_id_idx" ON "sys_virtual_company"("holder_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_virtual_company_tenant_id_code_key" ON "sys_virtual_company"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "sys_virtual_member_tenant_id_idx" ON "sys_virtual_member"("tenant_id");

-- CreateIndex
CREATE INDEX "sys_virtual_member_virtual_company_id_idx" ON "sys_virtual_member"("virtual_company_id");

-- CreateIndex
CREATE INDEX "sys_virtual_member_member_company_id_idx" ON "sys_virtual_member"("member_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_virtual_member_tenant_id_virtual_company_id_member_comp_key" ON "sys_virtual_member"("tenant_id", "virtual_company_id", "member_company_id");

-- CreateIndex
CREATE INDEX "sys_virtual_share_tenant_id_idx" ON "sys_virtual_share"("tenant_id");

-- CreateIndex
CREATE INDEX "sys_virtual_share_virtual_company_id_idx" ON "sys_virtual_share"("virtual_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_virtual_share_tenant_id_virtual_company_id_object_id_key" ON "sys_virtual_share"("tenant_id", "virtual_company_id", "object_id");

-- Data: dosavadní sdílený adresář a dimenze → jedna virtuální společnost s nosnou
-- (skrytou) firmou; členy jsou všechny dosavadní firmy tenanta. Firmu lze pak osamostatnit.
CREATE TEMP TABLE "_vc" AS
  SELECT t."id" AS "tenant_id", gen_random_uuid() AS "hid", gen_random_uuid() AS "vid"
  FROM "sys_tenant" t WHERE EXISTS (SELECT 1 FROM "sys_company" c WHERE c."tenant_id" = t."id");
INSERT INTO "sys_company" ("id", "tenant_id", "code", "name", "currency", "country", "vat_payer", "virtual")
  SELECT "hid", "tenant_id", 'V-SDILENE', 'Sdílený adresář a dimenze', 'CZK', 'CZ', false, true FROM "_vc";
INSERT INTO "sys_virtual_company" ("id", "tenant_id", "code", "name", "holder_company_id")
  SELECT "vid", "tenant_id", 'SDILENE', 'Sdílený adresář a dimenze', "hid" FROM "_vc";
INSERT INTO "sys_virtual_member" ("id", "tenant_id", "virtual_company_id", "member_company_id")
  SELECT gen_random_uuid(), v."tenant_id", v."vid", c."id" FROM "_vc" v JOIN "sys_company" c ON c."tenant_id" = v."tenant_id" AND c."virtual" = false;
INSERT INTO "sys_virtual_share" ("id", "tenant_id", "virtual_company_id", "object_id")
  SELECT gen_random_uuid(), v."tenant_id", v."vid", o FROM "_vc" v, unnest(ARRAY['gab.subject', 'gab.address', 'gab.contact', 'gl.dimension', 'gl.dimensionValue']) o;
UPDATE "gab_subject" x SET "company_id" = v."hid" FROM "_vc" v WHERE x."tenant_id" = v."tenant_id";
UPDATE "gab_address" x SET "company_id" = v."hid" FROM "_vc" v WHERE x."tenant_id" = v."tenant_id";
UPDATE "gab_contact" x SET "company_id" = v."hid" FROM "_vc" v WHERE x."tenant_id" = v."tenant_id";
UPDATE "gl_dimension" x SET "company_id" = v."hid" FROM "_vc" v WHERE x."tenant_id" = v."tenant_id";
UPDATE "gl_dimension_value" x SET "company_id" = v."hid" FROM "_vc" v WHERE x."tenant_id" = v."tenant_id";
DROP TABLE "_vc";
ALTER TABLE "gab_subject" ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "gab_address" ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "gab_contact" ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "gl_dimension" ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "gl_dimension_value" ALTER COLUMN "company_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "gab_subject_tenant_id_company_id_idx" ON "gab_subject"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "gab_address_tenant_id_company_id_idx" ON "gab_address"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "gab_contact_tenant_id_company_id_idx" ON "gab_contact"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "gl_dimension_tenant_id_company_id_idx" ON "gl_dimension"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "gl_dimension_tenant_id_company_id_code_key" ON "gl_dimension"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "gl_dimension_tenant_id_company_id_position_key" ON "gl_dimension"("tenant_id", "company_id", "position");

-- CreateIndex
CREATE INDEX "gl_dimension_value_tenant_id_company_id_idx" ON "gl_dimension_value"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "gl_dimension_value_tenant_id_company_id_dimension_id_code_key" ON "gl_dimension_value"("tenant_id", "company_id", "dimension_id", "code");

-- AddForeignKey
ALTER TABLE "sys_virtual_company" ADD CONSTRAINT "sys_virtual_company_holder_company_id_fkey" FOREIGN KEY ("holder_company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_virtual_member" ADD CONSTRAINT "sys_virtual_member_virtual_company_id_fkey" FOREIGN KEY ("virtual_company_id") REFERENCES "sys_virtual_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_virtual_member" ADD CONSTRAINT "sys_virtual_member_member_company_id_fkey" FOREIGN KEY ("member_company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_virtual_share" ADD CONSTRAINT "sys_virtual_share_virtual_company_id_fkey" FOREIGN KEY ("virtual_company_id") REFERENCES "sys_virtual_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gab_subject" ADD CONSTRAINT "gab_subject_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gab_address" ADD CONSTRAINT "gab_address_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gab_contact" ADD CONSTRAINT "gab_contact_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_dimension" ADD CONSTRAINT "gl_dimension_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_dimension_value" ADD CONSTRAINT "gl_dimension_value_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
