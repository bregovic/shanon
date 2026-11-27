-- AlterTable
ALTER TABLE "qa_feedback" ADD COLUMN     "author_user_id" VARCHAR(36);

-- dosavadní náměty: zadavatel = kdo je zapsal
UPDATE "qa_feedback" SET "author_user_id" = "created_by"::text WHERE "author_user_id" IS NULL AND "created_by" IS NOT NULL;
