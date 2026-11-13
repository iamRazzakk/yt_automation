import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

function loadDotEnv(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../.env"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    break;
  }
}

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url(),
  /** Unused — login removed; kept optional for old .env files. */
  ADMIN_PASSWORD: z.string().optional().default(""),
  SESSION_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes)"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  STORAGE_ROOT: z.string().min(1),
  DISK_BLOCK_NEW_JOBS_PCT: z.coerce.number().min(1).max(99).default(85),
  MIN_FREE_GB: z.coerce.number().positive().default(10),
  /** Free-space multiplier vs yt-dlp filesize_approx before download (SPEC default 3). */
  DOWNLOAD_SPACE_MULTIPLIER: z.coerce.number().positive().default(3),
  ORIGINAL_RETENTION_DAYS: z.coerce.number().int().positive().default(2),
  CLIP_RETENTION_DAYS: z.coerce.number().int().positive().default(14),

  MAX_VIDEO_DURATION_MIN: z.coerce.number().int().positive().default(60),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(2048),
  CLIP_MIN_SEC: z.coerce.number().positive().default(30),
  CLIP_MAX_SEC: z.coerce.number().positive().default(55),
  CLIPS_PER_VIDEO: z.coerce.number().int().positive().default(5),
  FFMPEG_PRESET: z.string().default("veryfast"),
  DEFAULT_TEMPLATE_ID: z.string().default("default"),
  THUMBNAILS_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  YTDLP_COOKIES_PATH: z.string().optional().default(""),

  WHISPER_MODEL: z.string().default("base"),
  WHISPER_DEVICE: z.string().default("cpu"),
  WHISPER_COMPUTE_TYPE: z.string().default("int8"),
  OLLAMA_HOST: z.string().url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("qwen2.5:3b"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  OLLAMA_DISABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  HEAVY_SLOTS: z.coerce.number().int().positive().default(1),
  WORKER_DOWNLOAD_CONCURRENCY: z.coerce.number().int().positive().default(2),
  WORKER_TRANSCRIBE_CONCURRENCY: z.coerce.number().int().positive().default(1),
  WORKER_ANALYZE_CONCURRENCY: z.coerce.number().int().positive().default(1),
  WORKER_RENDER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  WORKER_PUBLISH_CONCURRENCY: z.coerce.number().int().positive().default(1),

  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  GOOGLE_REDIRECT_URI: z.string().url().optional().default("http://localhost:4000/api/youtube/callback"),
  YT_DEFAULT_PRIVACY: z.enum(["private", "unlisted", "public"]).default("public"),
  YT_DEFAULT_CATEGORY_ID: z.string().default("22"),
  YT_DRY_RUN: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  loadDotEnv();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${details}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: reset cached config. */
export function resetConfigCache(): void {
  cached = null;
}
