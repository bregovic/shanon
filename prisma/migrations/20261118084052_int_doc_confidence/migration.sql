-- AlterTable
ALTER TABLE "int_connection" ADD COLUMN     "responsible" VARCHAR(36),
ALTER COLUMN "auto_list" SET DEFAULT true;

-- AlterTable
ALTER TABLE "int_portal" ADD COLUMN     "responsible" VARCHAR(36);

-- AlterTable
ALTER TABLE "int_document" ADD COLUMN     "confidence" VARCHAR(40),
ADD COLUMN     "uncertain" VARCHAR(255);

-- jistě vytěžené doklady se zalistují samy (kontrolu hlídá úkol Zkontrolovat) — i u stávajících napojení
UPDATE "int_connection" SET "auto_list" = true WHERE "kind" = 'ocr';
