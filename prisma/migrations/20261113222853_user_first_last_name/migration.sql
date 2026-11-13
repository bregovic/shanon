-- AlterTable
ALTER TABLE "sys_user" ADD COLUMN     "first_name" VARCHAR(60) NOT NULL DEFAULT '',
ADD COLUMN     "last_name" VARCHAR(60) NOT NULL DEFAULT '';

-- Data: stávající celé jméno → jméno (první slovo) a příjmení (zbytek)
UPDATE "sys_user" SET
  "first_name" = CASE WHEN position(' ' in trim("name")) > 0 THEN split_part(trim("name"), ' ', 1) ELSE '' END,
  "last_name" = CASE WHEN position(' ' in trim("name")) > 0 THEN substr(trim("name"), position(' ' in trim("name")) + 1) ELSE trim("name") END
WHERE "first_name" = '' AND "last_name" = '';
