-- AlterTable
ALTER TABLE "qa_issue" ADD COLUMN     "priority_rank" INTEGER;

-- stávající požadavky: pořadí podle priority
UPDATE "qa_issue" SET "priority_rank" = CASE "priority" WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'low' THEN 4 ELSE 3 END;
