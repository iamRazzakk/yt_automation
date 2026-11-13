-- AlterTable
ALTER TABLE "clips" ADD COLUMN "publish_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "clips_publish_at_status_idx" ON "clips"("publish_at", "status");
