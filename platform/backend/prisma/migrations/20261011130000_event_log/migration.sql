-- CreateEnum
CREATE TYPE "EventSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- AlterTable: the table was unused so far; the default only covers existing rows.
ALTER TABLE "events" ADD COLUMN "severity" "EventSeverity" NOT NULL DEFAULT 'INFO',
ADD COLUMN "data" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "events" ALTER COLUMN "severity" DROP DEFAULT;

-- DropIndex
DROP INDEX "events_ts_idx";
DROP INDEX "events_device_id_idx";

-- CreateIndex
CREATE INDEX "events_ts_id_idx" ON "events"("ts", "id");
CREATE INDEX "events_device_id_ts_idx" ON "events"("device_id", "ts");
