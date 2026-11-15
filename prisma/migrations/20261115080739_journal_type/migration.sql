-- AlterTable
ALTER TABLE "gl_journal" ADD COLUMN     "journal_type" VARCHAR(40);

-- stávající deníky: druh podle názvu deníku
UPDATE "gl_journal" j SET "journal_type" = n."journal_type"
FROM "gl_journal_name" n WHERE j."journal_name_id" = n."id" AND j."journal_type" IS NULL;
