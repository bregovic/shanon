-- AlterTable
ALTER TABLE "sys_favorite" DROP CONSTRAINT "sys_favorite_pkey",
ADD COLUMN     "folder" VARCHAR(60),
ALTER COLUMN "href" SET DATA TYPE VARCHAR(1000),
ADD CONSTRAINT "sys_favorite_pkey" PRIMARY KEY ("user_id", "href");
