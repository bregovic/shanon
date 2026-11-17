-- AlterTable
ALTER TABLE "int_connection" ADD COLUMN     "data_bits" INTEGER DEFAULT 8,
ADD COLUMN     "parity" VARCHAR(40) DEFAULT 'none',
ADD COLUMN     "scale_protocol" VARCHAR(40) DEFAULT 'toledo8217',
ADD COLUMN     "stop_bits" INTEGER DEFAULT 1;
