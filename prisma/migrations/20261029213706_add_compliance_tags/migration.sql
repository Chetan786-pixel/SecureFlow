-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "complianceTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "PolicyTemplate" ADD COLUMN     "complianceTags" TEXT[] DEFAULT ARRAY[]::TEXT[];
