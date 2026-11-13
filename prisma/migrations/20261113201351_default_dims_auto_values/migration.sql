-- AlterTable
ALTER TABLE "gl_dimension" ADD COLUMN     "next_value" INTEGER DEFAULT 1,
ADD COLUMN     "value_digits" INTEGER DEFAULT 5,
ADD COLUMN     "value_prefix" VARCHAR(10);

-- AlterTable
ALTER TABLE "gl_dimension_value" ADD COLUMN     "subject_id" UUID;

-- AlterTable
ALTER TABLE "gl_account" ADD COLUMN     "dim1" VARCHAR(20),
ADD COLUMN     "dim2" VARCHAR(20),
ADD COLUMN     "dim3" VARCHAR(20),
ADD COLUMN     "dim4" VARCHAR(20),
ADD COLUMN     "dim5" VARCHAR(20),
ADD COLUMN     "dim6" VARCHAR(20);

-- AlterTable
ALTER TABLE "ar_customer" ADD COLUMN     "dim1" VARCHAR(20),
ADD COLUMN     "dim2" VARCHAR(20),
ADD COLUMN     "dim3" VARCHAR(20),
ADD COLUMN     "dim4" VARCHAR(20),
ADD COLUMN     "dim5" VARCHAR(20),
ADD COLUMN     "dim6" VARCHAR(20);

-- AlterTable
ALTER TABLE "ap_vendor" ADD COLUMN     "dim1" VARCHAR(20),
ADD COLUMN     "dim2" VARCHAR(20),
ADD COLUMN     "dim3" VARCHAR(20),
ADD COLUMN     "dim4" VARCHAR(20),
ADD COLUMN     "dim5" VARCHAR(20),
ADD COLUMN     "dim6" VARCHAR(20);

-- CreateIndex
CREATE INDEX "gl_dimension_value_subject_id_idx" ON "gl_dimension_value"("subject_id");

-- AddForeignKey
ALTER TABLE "gl_dimension_value" ADD CONSTRAINT "gl_dimension_value_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "gab_subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
