-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('QUEUED', 'DOWNLOADING', 'TRANSCRIBING', 'ANALYZING', 'RENDERING', 'READY', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClipStatus" AS ENUM ('RENDERING', 'READY', 'REJECTED', 'APPROVED', 'PUBLISH_QUEUED', 'UPLOADING', 'PUBLISHED', 'PUBLISH_FAILED', 'RENDER_FAILED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('youtube', 'upload');

-- CreateEnum
CREATE TYPE "ErrorCategory" AS ENUM ('USER_INPUT', 'EXTERNAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "JobEventLevel" AS ENUM ('info', 'warn', 'error');

-- CreateTable
CREATE TABLE "videos" (
    "id" TEXT NOT NULL,
    "source_type" "SourceType" NOT NULL,
    "source_url" TEXT,
    "source_video_id" TEXT,
    "title" TEXT,
    "duration_sec" INTEGER,
    "status" "VideoStatus" NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage_detail" TEXT,
    "template_id" TEXT NOT NULL,
    "error_code" TEXT,
    "error_category" "ErrorCategory",
    "error_message" TEXT,
    "original_key" TEXT,
    "audio_key" TEXT,
    "original_deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcripts" (
    "video_id" TEXT NOT NULL,
    "language" TEXT,
    "data" JSONB NOT NULL,

    CONSTRAINT "transcripts_pkey" PRIMARY KEY ("video_id")
);

-- CreateTable
CREATE TABLE "clips" (
    "id" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "start_sec" DOUBLE PRECISION NOT NULL,
    "end_sec" DOUBLE PRECISION NOT NULL,
    "heuristic_score" DOUBLE PRECISION NOT NULL,
    "llm_score" DOUBLE PRECISION,
    "final_score" DOUBLE PRECISION NOT NULL,
    "hook_text" TEXT,
    "title_options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "yt_title" TEXT NOT NULL,
    "yt_description" TEXT NOT NULL,
    "yt_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "yt_privacy" TEXT NOT NULL,
    "status" "ClipStatus" NOT NULL,
    "video_key" TEXT,
    "thumb_key" TEXT,
    "size_bytes" BIGINT,
    "yt_video_id" TEXT,
    "yt_upload_session_url" TEXT,
    "yt_thumb_error" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "expires_at" TIMESTAMPTZ,
    "approved_at" TIMESTAMPTZ,
    "published_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "clips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "youtube_account" (
    "id" INTEGER NOT NULL,
    "channel_id" TEXT,
    "channel_title" TEXT,
    "refresh_token_enc" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "needs_reconnect" BOOLEAN NOT NULL DEFAULT false,
    "connected_at" TIMESTAMPTZ,

    CONSTRAINT "youtube_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_events" (
    "id" BIGSERIAL NOT NULL,
    "video_id" TEXT NOT NULL,
    "clip_id" TEXT,
    "stage" TEXT,
    "level" "JobEventLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "videos_created_at_idx" ON "videos"("created_at" DESC);

-- CreateIndex
CREATE INDEX "videos_status_idx" ON "videos"("status");

-- CreateIndex
CREATE INDEX "clips_video_id_idx" ON "clips"("video_id");

-- CreateIndex
CREATE INDEX "clips_status_idx" ON "clips"("status");

-- CreateIndex
CREATE INDEX "clips_expires_at_idx" ON "clips"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "clips_video_id_idx_key" ON "clips"("video_id", "idx");

-- CreateIndex
CREATE INDEX "job_events_video_id_id_idx" ON "job_events"("video_id", "id");

-- AddForeignKey
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clips" ADD CONSTRAINT "clips_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "clips"("id") ON DELETE SET NULL ON UPDATE CASCADE;
