-- AlterEnum (safe version - maps legacy completed_won/completed_lost values to "completed" via a
-- text intermediate, since a Postgres enum column can't hold a value that isn't in its OWN type
-- yet, and the naive generated migration's direct enum-to-enum cast would fail on any row still
-- carrying one of the two removed values).
BEGIN;
ALTER TABLE "pocs" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "pocs" ALTER COLUMN "status" TYPE TEXT USING ("status"::text);
UPDATE "pocs" SET "status" = 'completed' WHERE "status" IN ('completed_won', 'completed_lost');
CREATE TYPE "PocStatus_new" AS ENUM ('not_started', 'planned', 'in_progress', 'blocked', 'completed');
ALTER TABLE "pocs" ALTER COLUMN "status" TYPE "PocStatus_new" USING ("status"::"PocStatus_new");
DROP TYPE IF EXISTS "PocStatus";
ALTER TYPE "PocStatus_new" RENAME TO "PocStatus";
ALTER TABLE "pocs" ALTER COLUMN "status" SET DEFAULT 'not_started';
COMMIT;

-- AlterTable
ALTER TABLE "pocs" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false;
