-- DropForeignKey
ALTER TABLE "project_pricing_sheets" DROP CONSTRAINT "project_pricing_sheets_source_analysis_result_id_fkey";

-- AlterTable
ALTER TABLE "project_pricing_sheets" ADD COLUMN     "label" TEXT,
ALTER COLUMN "project_id" DROP NOT NULL,
ALTER COLUMN "source_analysis_result_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "project_pricing_sheets" ADD CONSTRAINT "project_pricing_sheets_source_analysis_result_id_fkey" FOREIGN KEY ("source_analysis_result_id") REFERENCES "analysis_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;
