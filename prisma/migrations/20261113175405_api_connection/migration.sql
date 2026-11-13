-- AlterTable
ALTER TABLE "int_connection" ADD COLUMN     "scopes" VARCHAR(400),
ADD COLUMN     "token_hash" VARCHAR(64),
ADD COLUMN     "token_prefix" VARCHAR(40);
