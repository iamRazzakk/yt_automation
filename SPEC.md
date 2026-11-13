# Shorts Studio: Full Project Spec

A personal, single-user, self-hosted tool. Input: a long video (YouTube link or uploaded file). Output: several vertical short clips (30-59 s) placed into a Figma-designed frame, with captions, title, description, tags and thumbnail. The owner reviews each clip on a dashboard and clicks **Approve**, which uploads the clip to the owner's own YouTube channel.

---

## 0. Instructions for the coding agent (read first)

1. Read this whole document before writing code.
2. Build in the order of **Section 22 (Build Phases)**. Finish each phase, run `typecheck`, `lint`, `test`, and the phase's acceptance checks, then commit with message `phase-N: <name>`.
3. Do not add features that are not listed. Do not add multi-user support, billing, S3, or any paid/external AI API.
4. When something is ambiguous, pick the documented default, and record the choice in `DECISIONS.md` (one line each).
5. TypeScript strict mode, ESM, no `any` without a comment. Validate every external input with `zod`.
6. Keep algorithmic code in **pure functions** (no I/O) under `domain/` so it is unit-testable.
7. Never build shell command strings. Always `spawn(cmd, argsArray)` (no `shell: true`).
8. Every worker must be **idempotent** and must clean its temp directory in a `finally` block.
9. Target reliability: **at most 5% of videos end in `FAILED` due to SYSTEM errors** (see Section 18). Prefer graceful fallbacks over failing.

---

## 1. Product scope

### Goals
- Paste a YouTube link (or upload a file) and get N ready-to-review short clips.
- Clips are rendered into a fixed visual template exported from Figma.
- Auto-generated title / description / tags / thumbnail per clip (local LLM via Ollama).
- One-click Approve on the dashboard uploads the clip to the owner's YouTube channel.
- Fully self-hosted on one VPS. Storage is local disk. No paid APIs.

### Non-goals (do NOT build)
- Multi-user accounts, registration, teams, billing, quotas per user.
- S3 / cloud storage (keep the storage interface, implement local only).
- Any external AI API (OpenAI, Claude, etc.). AI is Whisper (local) + Ollama (local) only.
- Other platforms (TikTok, Instagram).
- Face tracking / auto-reframe, karaoke-style word highlighting, scheduling, Bangla caption quality tuning. These are **P2**, listed in Section 3 but built only after everything else is done.

---

## 2. Locked decisions

| Topic | Decision |
|---|---|
| Users | Single owner. One shared admin password. |
| Backend | Node.js 20, TypeScript, Fastify, Prisma, PostgreSQL |
| Queue | BullMQ + Redis |
| Transcription | faster-whisper (Python script, CPU, int8), word timestamps, VAD on |
| LLM | Ollama (default `qwen2.5:3b`), structured JSON output, always with heuristic fallback |
| Video | FFmpeg / ffprobe, yt-dlp |
| Frontend | Next.js (App Router) + Tailwind, polling with TanStack Query |
| Storage | Local disk behind a `StorageProvider` interface |
| Reverse proxy | Caddy (auto HTTPS) or Nginx |
| Deploy | Docker Compose on one VPS (CPU only, min 4 vCPU / 8 GB RAM / 100 GB SSD) |
| YouTube | Official YouTube Data API v3, OAuth 2.0, resumable upload |
| Output format | 1080x1920, H.264/AAC, 30 fps, `+faststart`, clip length 30-59 s |

---

## 3. Features

Priority: **P0** must ship, **P1** should ship, **P2** later.

| ID | Feature | Pri |
|---|---|---|
| F1 | Admin login (single password, signed httpOnly cookie) | P0 |
| F2 | Submit a YouTube URL | P0 |
| F3 | Upload a video file (fallback when yt-dlp is blocked) | P0 |
| F4 | Download + validate (duration limit, codec, corruption) | P0 |
| F5 | Transcription with word timestamps | P0 |
| F6 | Highlight detection: heuristic candidates + Ollama re-rank + fallback | P0 |
| F7 | Render clips into Figma template (background, video slot, overlay PNG, captions) | P0 |
| F8 | Metadata generation per clip: 3 title options, description, tags, hook text | P0 |
| F9 | Thumbnail generation (best frame + template overlay + title text) | P1 |
| F10 | Review dashboard: preview, edit metadata, approve / reject | P0 |
| F11 | YouTube connect (OAuth) and one-click publish on Approve | P0 |
| F12 | Job progress, per-video event log, retry failed stage, cancel | P0 |
| F13 | Disk guard, retention cleanup, yt-dlp auto-update | P0 |
| F14 | System page: disk usage, queue counts, tool versions, failure rate | P1 |
| F15 | Regenerate metadata for a clip | P1 |
| F16 | Adjust clip start/end and re-render | P2 |
| F17 | Scheduled publish (`publishAt`) | P2 |
| F18 | Karaoke word highlight captions | P2 |
| F19 | Multiple templates selectable per video | P2 |
| F20 | Face-aware crop | P2 |

---

## 4. High-Level Design (HLD)

```
                      Browser (owner)
                           |
                      HTTPS (Caddy)
              +------------+-------------+
              |                          |
         Next.js web               Fastify API  (/api/*)
         (dashboard)                     |
                                         +--> PostgreSQL (state, metadata, transcripts)
                                         +--> Redis (BullMQ queues, locks, semaphore)
                                         +--> Local disk (/data) via StorageProvider
                                         |
                                  enqueue jobs
                                         |
     +-------------+-------------+-------+------+--------------+-------------+
     |             |             |              |              |             |
 [download]   [transcribe]   [analyze]       [render]       [publish]   [maintenance]
  yt-dlp      faster-whisper  heuristic +    FFmpeg +        YouTube       cleanup,
  ffprobe     (python)        Ollama         sharp (thumb)   Data API      disk, yt-dlp -U
```

### 4.1 Pipeline

```
VIDEO:  QUEUED -> DOWNLOADING -> TRANSCRIBING -> ANALYZING -> RENDERING -> READY
                                                                     \-> FAILED / CANCELLED

CLIP:   RENDERING -> READY -> APPROVED -> PUBLISH_QUEUED -> UPLOADING -> PUBLISHED
                        \-> REJECTED               \-> PUBLISH_FAILED
        RENDERING -> RENDER_FAILED
```

1. **download**: validate URL, fetch metadata, check duration, download, `ffprobe` validate, extract 16 kHz mono WAV.
2. **transcribe**: faster-whisper produces segments, words, per-second audio energy. Stored in DB.
3. **analyze**: build sentences, generate candidate windows, score heuristically, Ollama re-rank, select top N non-overlapping, generate metadata per clip (LLM with fallback). Creates `clips` rows.
4. **render**: one job per clip (fan-out). FFmpeg render with template, captions, thumbnail.
5. Video becomes `READY` when all its clips reach a terminal render state and at least one is `READY`. If zero clips rendered, video is `FAILED` with `NO_CLIPS` or `RENDER_FAILED`.
6. **publish**: triggered by Approve. Resumable upload to YouTube, set thumbnail, store `youtube_video_id`.

### 4.2 Resource model (single VPS, CPU only)

- Whisper and Ollama are RAM-heavy and must **not run at the same time** on an 8 GB box. Use a Redis semaphore named `heavy` with `HEAVY_SLOTS` (default 1). `transcribe` and the LLM portion of `analyze` acquire it. Render has its own concurrency.
- Ollama requests use `keep_alive: "30s"` so the model unloads soon after use.
- Concurrency defaults: download 2, transcribe 1, analyze 1, render 1 (2 if >= 8 vCPU), publish 1.

---

## 5. Repository structure

```
shorts-studio/
  apps/
    server/
      prisma/schema.prisma
      scripts/transcribe.py
      src/
        entry-api.ts
        entry-worker.ts
        api/
          plugins/        (auth, errors, cookies, multipart)
          routes/         (auth, videos, clips, youtube, system, templates, files)
        workers/
          download.ts  transcribe.ts  analyze.ts  render.ts  publish.ts  maintenance.ts
        domain/           (PURE logic, fully unit tested)
          sentences.ts  candidates.ts  scoring.ts  select.ts
          captions-ass.ts  ffmpeg-args.ts  metadata-sanitize.ts  errors.ts
        infra/
          config.ts  logger.ts  db.ts  redis.ts  queues.ts  semaphore.ts
          storage/ (provider.ts, local.ts)
          ytdlp.ts  ffmpeg.ts  whisper.ts  ollama.ts  youtube.ts  crypto.ts  disk.ts
      test/
    web/
      app/  components/  lib/
  assets/
    templates/default/{layout.json, overlay.png, thumb_overlay.png}
    fonts/            (Inter, Noto Sans, Noto Sans Bengali; TTF)
    lexicon.en.json   (hook words/patterns, stopwords)
  docker/{Dockerfile.server, Dockerfile.web, Caddyfile}
  docker-compose.yml
  .env.example
  DECISIONS.md
  SPEC.md
```

---

## 6. Configuration (`.env.example`)

Load and validate with a `zod` schema in `infra/config.ts`. The app must **fail at startup** with a clear message if anything required is missing or invalid.

```env
# ===== APP =====
API_PORT=4000
APP_URL=http://localhost:3000
ADMIN_PASSWORD=change_me
SESSION_SECRET=change_me_min_32_chars
# openssl rand -hex 32  (encrypts YouTube refresh token)
TOKEN_ENCRYPTION_KEY=

# ===== DB / REDIS =====
DATABASE_URL=postgresql://shorts:password@localhost:5432/shorts_db
REDIS_URL=redis://localhost:6379

# ===== STORAGE =====
STORAGE_ROOT=/data
DISK_BLOCK_NEW_JOBS_PCT=85
MIN_FREE_GB=10
ORIGINAL_RETENTION_DAYS=2
CLIP_RETENTION_DAYS=14

# ===== VIDEO =====
MAX_VIDEO_DURATION_MIN=60
MAX_UPLOAD_SIZE_MB=2048
CLIP_MIN_SEC=30
CLIP_MAX_SEC=55
CLIPS_PER_VIDEO=5
FFMPEG_PRESET=veryfast
DEFAULT_TEMPLATE_ID=default
THUMBNAILS_ENABLED=true
YTDLP_COOKIES_PATH=

# ===== AI =====
WHISPER_MODEL=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_TIMEOUT_MS=120000
OLLAMA_DISABLED=false          # true = always use heuristic fallback

# ===== WORKERS =====
HEAVY_SLOTS=1
WORKER_DOWNLOAD_CONCURRENCY=2
WORKER_TRANSCRIBE_CONCURRENCY=1
WORKER_ANALYZE_CONCURRENCY=1
WORKER_RENDER_CONCURRENCY=1
WORKER_PUBLISH_CONCURRENCY=1

# ===== YOUTUBE =====
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:4000/api/youtube/callback
YT_DEFAULT_PRIVACY=private     # private | unlisted | public
YT_DEFAULT_CATEGORY_ID=22
YT_DRY_RUN=false               # true = write the upload payload to disk, never call YouTube
```

`GOOGLE_REDIRECT_URI` must match **exactly** what is registered in Google Cloud Console.

---

## 7. Data model (PostgreSQL via Prisma)

Translate to `schema.prisma`. IDs are `cuid()` strings. All timestamps `timestamptz`.

```sql
-- single owner, so no users table
videos(
  id              text pk,
  source_type     text not null,            -- 'youtube' | 'upload'
  source_url      text null,
  source_video_id text null,                -- YouTube id, for dedupe
  title           text null,
  duration_sec    int  null,
  status          text not null,            -- VideoStatus
  progress        int  not null default 0,  -- 0..100 for current stage
  stage_detail    text null,
  template_id     text not null,
  error_code      text null,
  error_category  text null,                -- USER_INPUT | EXTERNAL | SYSTEM
  error_message   text null,
  original_key    text null,                -- storage key
  audio_key       text null,
  original_deleted_at timestamptz null,
  created_at, updated_at
)

transcripts(
  video_id   text pk fk videos on delete cascade,
  language   text,
  data       jsonb not null   -- {segments:[{start,end,text,words:[{w,start,end,p}]}], energy:{hop:1,rms:[...]}}
)

clips(
  id                text pk,
  video_id          text fk videos on delete cascade,
  idx               int  not null,
  start_sec         float not null,
  end_sec           float not null,
  heuristic_score   float not null,
  llm_score         float null,
  final_score       float not null,
  hook_text         text null,
  title_options     text[] not null default '{}',
  yt_title          text not null,
  yt_description    text not null,
  yt_tags           text[] not null default '{}',
  yt_privacy        text not null,
  status            text not null,          -- ClipStatus
  video_key         text null,
  thumb_key         text null,
  size_bytes        bigint null,
  yt_video_id       text null,
  yt_upload_session_url text null,          -- resumable upload session, for safe retry
  yt_thumb_error    text null,
  error_code        text null,
  error_message     text null,
  expires_at        timestamptz null,
  approved_at       timestamptz null,
  published_at      timestamptz null,
  created_at, updated_at,
  unique(video_id, idx)
)

youtube_account(                             -- at most one row
  id               int pk check (id = 1),
  channel_id       text,
  channel_title    text,
  refresh_token_enc text not null,
  scopes           text not null,
  needs_reconnect  boolean not null default false,
  connected_at     timestamptz
)

job_events(                                   -- per-video timeline shown in UI
  id bigserial pk, video_id text fk, clip_id text null,
  stage text, level text,                     -- info | warn | error
  message text, data jsonb null, created_at timestamptz default now()
)

settings( key text pk, value jsonb )          -- default privacy, default template, etc.
```

Indexes: `videos(created_at desc)`, `videos(status)`, `clips(video_id)`, `clips(status)`, `clips(expires_at)`, `job_events(video_id, id)`, unique partial on `videos(source_video_id)` is **not** enforced (re-processing the same source is allowed; the UI warns on duplicates).

---

## 8. Storage

```ts
interface StorageProvider {
  put(key: string, source: Readable | string /*local path*/): Promise<void>   // atomic: write tmp, fsync, rename
  getStream(key: string, range?: { start: number; end?: number }): Promise<Readable>
  stat(key: string): Promise<{ size: number } | null>
  delete(key: string): Promise<void>
  deletePrefix(prefix: string): Promise<void>
  localPath(key: string): string   // local driver only
}
```

- Keys: `videos/{videoId}/original.mp4`, `videos/{videoId}/audio.wav`, `clips/{videoId}/{clipId}.mp4`, `clips/{videoId}/{clipId}.jpg`, `tmp/{jobId}/...`.
- `LocalStorage` resolves keys under `STORAGE_ROOT`, **rejects** keys containing `..`, absolute paths, or null bytes, and verifies the resolved path stays inside the root.
- Never accept a path or key from the client. Only IDs.
- Files are served by the API with auth and HTTP Range support (needed for `<video>` seeking). Optional optimisation: `X-Accel-Redirect` (Nginx) or Caddy `file_server` after the auth check.

### 8.1 Disk guard (`infra/disk.ts`)
- Use `fs.statfs` on `STORAGE_ROOT`.
- `POST /api/videos` and uploads are **rejected** with `DISK_LOW` when used >= `DISK_BLOCK_NEW_JOBS_PCT` or free < `MIN_FREE_GB`.
- Before download, require free space >= 3x the expected file size (estimate from yt-dlp metadata `filesize_approx`, else assume 1.5 GB).

### 8.2 Retention (`maintenance` worker, daily cron `0 3 * * *`)
- Delete `original.mp4` and `audio.wav` for videos in `READY`/`FAILED` older than `ORIGINAL_RETENTION_DAYS`; set `original_deleted_at`. (Re-render is impossible afterwards; the UI must show that.)
- Delete clip files where `expires_at < now()` and status is not `APPROVED | PUBLISH_QUEUED | UPLOADING`. `expires_at = created_at + CLIP_RETENTION_DAYS`. Published clips may be deleted at expiry too (the YouTube copy is the source of truth).
- Delete `REJECTED` clip files after 1 day.
- Delete orphan `tmp/*` directories older than 6 hours.
- Orphan scan: files on disk with no DB row are logged (do not auto-delete in v1).
- Update yt-dlp (`yt-dlp -U` or `pip install -U yt-dlp`) **weekly** and log the version. YouTube changes often and an outdated yt-dlp is the most common cause of download failures.

---

## 9. Queues and workers (LLD)

### 9.1 Queue config

| Queue | Concurrency | Attempts | Backoff | Job timeout |
|---|---|---|---|---|
| download | 2 | 3 | exp, 30 s | 20 min |
| transcribe | 1 | 2 | exp, 60 s | 90 min |
| analyze | 1 | 2 | exp, 30 s | 15 min |
| render | 1 | 3 | exp, 20 s | 10 min |
| publish | 1 | 3 (network/5xx only) | exp, 60 s | 30 min |
| maintenance | 1 | 1 | none | 30 min |

Rules:
- `jobId` = `${stage}:${entityId}` so the same job cannot be enqueued twice.
- Throw BullMQ `UnrecoverableError` for non-retryable errors (see Section 18).
- Use a long `lockDuration` (for example 5 min) with auto-renew for transcribe and render. Child processes are external, so the Node event loop stays free.
- On stalled job recovery the worker must re-check DB state and skip work that is already done (idempotency).
- Every child process gets a hard timeout; on timeout kill the **process tree** (`SIGTERM`, then `SIGKILL` after 5 s).
- Every worker updates `videos.status`, `progress`, `stage_detail` and appends `job_events`.
- Cancelling a video sets `CANCELLED`; workers check this flag between steps and exit early, then clean up.

### 9.2 download worker

1. Validate URL with a strict allowlist: hosts `youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`; scheme `https`; extract the video id. Reject playlists (`--no-playlist`).
2. `yt-dlp --dump-json --no-playlist <url>`: read `title`, `duration`, `filesize_approx`, `is_live`. Reject live streams. Reject if `duration > MAX_VIDEO_DURATION_MIN*60` with `VIDEO_TOO_LONG`.
3. Download:
   ```
   yt-dlp --no-playlist --newline -f "bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/bv*[height<=1080]+ba/b"
          --merge-output-format mp4 -o <tmp>/original.%(ext)s [--cookies <path>] <url>
   ```
   Parse progress lines (`[download]  42.3%`) into `videos.progress`.
4. `ffprobe -v error -show_streams -show_format -of json`: must contain a video stream and an audio stream, duration > 60 s, readable. Otherwise `MEDIA_CORRUPT`.
5. Extract audio: `ffmpeg -i original.mp4 -vn -ac 1 -ar 16000 -c:a pcm_s16le audio.wav`.
6. Move outputs to storage, set keys, enqueue `transcribe`.
7. For `source_type = 'upload'` the API has already streamed the file to `tmp`; steps 1-3 are skipped, steps 4-6 run.
8. Detect yt-dlp bot/IP-block signatures in stderr (`Sign in to confirm`, `HTTP Error 403`, `429`) and map to `DOWNLOAD_BLOCKED`, with a UI hint: "Upload the file instead or provide a cookies file."

### 9.3 transcribe worker

Acquire the `heavy` semaphore. Run `scripts/transcribe.py`:

```
python3 transcribe.py --audio audio.wav --model small --device cpu --compute int8 --out transcript.json
```

The script uses `faster_whisper.WhisperModel(model, device, compute_type)` and `transcribe(audio, word_timestamps=True, vad_filter=True, beam_size=5)`, auto-detects language, prints JSON progress lines to stdout (`{"progress":0.37}`), and additionally computes per-second RMS energy (numpy) over the WAV.

Output shape:
```json
{
  "language": "en",
  "duration": 1834.2,
  "segments": [{"start": 0.0, "end": 4.2, "text": "...", "words": [{"w": "Hello", "start": 0.1, "end": 0.4, "p": 0.98}]}],
  "energy": {"hop": 1, "rms": [0.01, 0.03]}
}
```

- Save to `transcripts.data`. If total word count < 50, fail with `NO_SPEECH` (category USER_INPUT).
- Model files live in a persistent volume (`/data/models`). Never download models at request time in production; pre-pull in the Docker image or first-run script.
- Enqueue `analyze`.

### 9.4 analyze worker

1. Load transcript. Run the pure pipeline (Section 10): sentences, candidates, scoring.
2. Take the top `CLIPS_PER_VIDEO * 3` candidates (after greedy non-overlap) for LLM re-rank.
3. If `OLLAMA_DISABLED=false`, acquire `heavy`, call Ollama (Section 11). On any failure, continue with heuristic scores only and log a `warn` event.
4. Final score and greedy selection of `CLIPS_PER_VIDEO` non-overlapping clips.
5. For each selected clip generate metadata (Section 10.5) with LLM, falling back to deterministic metadata. This step **must never throw**.
6. Insert `clips` rows (`status = RENDERING`, `yt_privacy = settings default`), then enqueue one `render` job per clip. Set video `RENDERING`.
7. If zero candidates exist, fail with `NO_CLIPS`.

### 9.5 render worker (per clip)

1. Load clip, video, transcript, template (`assets/templates/{id}/layout.json`).
2. Generate `captions.ass` for the clip (Section 12.2) into the job tmp dir.
3. Build FFmpeg args with `domain/ffmpeg-args.ts` (Section 12.1). Run with timeout. Parse `-progress pipe:1` for progress.
4. `ffprobe` the output: duration within `[CLIP_MIN_SEC - 2, 59.5]`, has audio and video. Otherwise `RENDER_FAILED` (retry).
5. If `THUMBNAILS_ENABLED`, generate a thumbnail (Section 10.6). Thumbnail failure is a `warn`, never a render failure.
6. Move outputs to storage, set `video_key`, `thumb_key`, `size_bytes`, `expires_at`, clip `READY`.
7. After finishing, check siblings; if all clips are terminal, set video `READY` (or `FAILED` if none are `READY`).

### 9.6 publish worker

See Section 13.

---

## 10. Algorithms (pure functions in `domain/`)

### 10.1 Sentences (`sentences.ts`)
Input: words with timestamps. Output: sentences `{start, end, text, wordRange}`.
- End a sentence at a word ending in `.`, `?`, `!`, `...`, or `।`.
- Also end it when the gap to the next word is > 0.8 s.
- Force-split sentences longer than 25 s at the largest internal gap.

### 10.2 Candidate generation (`candidates.ts`)
- For each sentence index `i` as a start (skip starts closer than 4 s to the previously accepted start), extend end index `j` while `duration <= CLIP_MAX_SEC`. Choose the `j` with `duration >= CLIP_MIN_SEC` whose duration is closest to a target of 45 s. Skip if none.
- Pad: `start -= 0.25 s`, `end += 0.35 s`, clamped to `[0, mediaDuration]`. Hard cap: duration <= 59.0 s.
- A candidate always starts at a sentence start and ends at a sentence end (completeness is enforced by construction).

### 10.3 Heuristic scoring (`scoring.ts`)
For each candidate compute raw features, min-max normalise each across all candidates to `[0,1]`, then combine.

| Feature | Definition | Weight |
|---|---|---|
| `hook` | First sentence is a question, or matches hook patterns (`assets/lexicon.en.json`: why/how/secret/mistake/never/stop/nobody/most people/biggest...), or contains a number | 0.25 |
| `energy` | Std-dev and mean of per-second RMS in the window (more dynamic delivery) | 0.20 |
| `rate` | Words per second; best near 2.5-3.2, penalise outside | 0.15 |
| `density` | Share of non-stopword tokens | 0.20 |
| `silence` | Share of seconds with RMS below a low threshold (**subtracted**) | -0.10 |
| `closure` | Last sentence ends with terminal punctuation | 0.10 |

Weights live in a config object so they are tunable. Return `heuristic_score` in `[0,1]`.

### 10.4 Selection (`select.ts`)
Greedy: sort by score desc; accept a candidate if its overlap with every accepted clip is < 20% of its own duration and the gap between accepted clips is at least 5 s; stop at the requested count.

### 10.5 Metadata (per clip)
LLM output (JSON, Section 11):
```json
{ "titles": ["...", "...", "..."], "description": "...", "tags": ["..."], "hook": "..." }
```
`metadata-sanitize.ts` enforces YouTube limits regardless of source:
- Title: <= 70 chars (hard max 100), no `<` or `>`, trimmed, no trailing hashtags spam.
- Description: <= 1000 chars here (YouTube max is 5000 bytes), no `<` `>`; append a line of 2-4 hashtags including `#Shorts`.
- Tags: 8-15 tags, each <= 30 chars, no `<` `>`, **total length (with separators) <= 450 chars**, lowercase, deduplicated.
- Fallback (deterministic, no LLM): title = first sentence of the clip truncated to 70 chars; description = first two sentences + hashtags; tags = top 10 non-stopword keywords by frequency.
- `yt_title` defaults to `titles[0]`; the user can pick another option in the UI.

### 10.6 Thumbnail (`THUMBNAILS_ENABLED`)
- Extract 8 evenly spaced frames from the clip window with FFmpeg (`-ss` per frame, scale to template thumb size).
- Score each with `sharp`: greyscale, Laplacian convolution, use the standard deviation as sharpness. Pick the best.
- Compose using `assets/templates/{id}/thumb_overlay.png` plus the title text (hook text, <= 6 words, rendered via an SVG overlay with a bundled font) using `sharp`. Output JPEG < 2 MB.
- Note: custom thumbnails need a phone-verified channel, and YouTube may not display custom thumbnails for Shorts in the Shorts feed. Therefore thumbnail upload failure is non-fatal.

---

## 11. Ollama usage (`infra/ollama.ts`)

- Endpoint: `POST {OLLAMA_HOST}/api/chat`, `stream: false`, `options: {temperature: 0.2, num_ctx: 4096}`, `keep_alive: "30s"`, and `format` set to a **JSON schema** (structured output).
- Validate the response with `zod`. On invalid JSON: retry once with an added instruction "Return only valid JSON matching the schema." If it fails again, throw `LlmError` (callers fall back).
- Timeout: `OLLAMA_TIMEOUT_MS`. Never send the full transcript. Send only candidate texts.

**Re-rank call** (once per video, batches of <= 8 candidates, each text truncated to ~900 chars):
```
System: You pick the most engaging segments for short vertical videos. Judge hook strength,
self-contained meaning, emotional or surprising content, and clear ending. Score 1-10.
User: Candidates: [{"id":0,"text":"..."}, ...]
Schema: {"scores":[{"id":int,"score":int,"reason":string<=80 chars}]}
```
`final_score = 0.5*heuristic + 0.5*(llm_score/10)`; if the LLM failed, `final_score = heuristic`.

**Metadata call** (once per selected clip): input is the clip text only (<= 1500 chars). Output schema in 10.5.

Health: on startup and in `/api/system/stats`, call `GET /api/tags` and show whether the model is present. The app works with Ollama down.

---

## 12. FFmpeg and template

### 12.1 Template (`assets/templates/default/layout.json`)

Exported from Figma: a 1080x1920 frame. `overlay.png` is the frame exported as PNG with a **transparent hole** where the video sits.

```json
{
  "id": "default",
  "canvas": { "width": 1080, "height": 1920 },
  "background": { "type": "blur", "color": "#000000" },
  "slot": { "x": 0, "y": 420, "width": 1080, "height": 1080, "fit": "cover" },
  "overlay": "overlay.png",
  "caption": {
    "font": "Inter", "fontSize": 64, "bold": true,
    "primaryColor": "#FFFFFF", "outlineColor": "#000000", "outline": 4,
    "x": 540, "y": 1640, "alignment": 2,
    "maxCharsPerLine": 26, "maxLines": 2, "wordsPerChunk": 4
  },
  "thumbnail": { "width": 1080, "height": 1920, "overlay": "thumb_overlay.png",
                 "titleBox": { "x": 60, "y": 1300, "width": 960, "height": 400, "fontSize": 88 } }
}
```
Validate it with `zod` at startup. Fail fast if any referenced file is missing.

### 12.2 Render command (build in `ffmpeg-args.ts`, return `string[]`)

Run with `cwd` = job tmp dir and use **relative filenames** (`captions.ass`, `overlay.png`) so the `ass` filter needs no path escaping. Copy the overlay PNG and fonts dir reference into the tmp dir.

```
ffmpeg -y -ss {start} -to {end} -i original.mp4 -loop 1 -i overlay.png
 -filter_complex "
   [0:v]split=2[bgsrc][fgsrc];
   [bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:5[bg];
   [fgsrc]scale={sw}:{sh}:force_original_aspect_ratio=increase,crop={sw}:{sh}[fg];
   [bg][fg]overlay={sx}:{sy}[base];
   [base][1:v]overlay=0:0:shortest=1[framed];
   [framed]ass=captions.ass:fontsdir={fontsdir}[out]"
 -map "[out]" -map 0:a? -af "loudnorm=I=-16:TP=-1.5:LRA=11"
 -t {duration} -r 30 -c:v libx264 -preset {preset} -crf 23 -pix_fmt yuv420p
 -c:a aac -b:a 128k -movflags +faststart -progress pipe:1 out.mp4
```
- If `background.type = "color"`, replace the blur chain with a `color=c=...:s=1080x1920` source.
- If `slot.fit = "contain"`, use `scale=...:force_original_aspect_ratio=decrease` and pad instead of crop.
- Unit-test `ffmpeg-args.ts` (snapshot the args array). Integration-test with a synthetic input generated by `ffmpeg -f lavfi -i testsrc=duration=70:size=1280x720:rate=30 -f lavfi -i sine=frequency=440:duration=70`.

### 12.3 Captions (`captions-ass.ts`)
- Words in `[start,end]`, times rebased by subtracting clip start.
- Group `wordsPerChunk` words, break lines at `maxCharsPerLine`, max `maxLines`.
- Each chunk is one `Dialogue` line from first word start to last word end (extend end to the next chunk start if the gap < 0.15 s).
- Escape `{`, `}`, `\` and newlines per ASS rules. Output a valid ASS header with `PlayResX/Y` = canvas size and the style built from `layout.caption`.
- Fonts: bundle Inter and Noto Sans; add Noto Sans Bengali for Bangla. Install into the image and run `fc-cache`.

---

## 13. YouTube integration (`infra/youtube.ts`)

### 13.1 OAuth
- Library: `googleapis`.
- Scopes: `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.readonly` (the latter only to read the channel title).
- `GET /api/youtube/connect`: create OAuth URL with `access_type=offline`, `prompt=consent`, a random `state` stored in a short-lived signed cookie. Redirect.
- `GET /api/youtube/callback`: verify `state`, exchange code, fetch channel info, store `refresh_token` encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`; store `iv|tag|ciphertext` base64). Redirect to `/settings`.
- If refresh fails with `invalid_grant`, set `needs_reconnect = true`, fail the publish with `YT_AUTH_EXPIRED`, and show a banner in the UI.
- Operational note (show in README): set the OAuth consent screen to **In production** (unverified is OK for a single owner). In **Testing** mode refresh tokens expire after about 7 days.

### 13.2 Upload (publish worker)
1. Preconditions: clip `APPROVED`, file exists, account connected and not `needs_reconnect`. With `YT_DRY_RUN=true`, write the request payload to `STORAGE_ROOT/dryrun/{clipId}.json`, mark `PUBLISHED` with a fake id, and return.
2. Set clip `UPLOADING`.
3. **Resumable upload**: initiate a session (`uploadType=resumable`) with the metadata below, **persist `yt_upload_session_url`**, then PUT the file in 8 MiB chunks with `Content-Range`. On failure/retry, query the session (`Content-Range: bytes */{total}`) and resume from the reported offset. If the session reports completion, parse the returned video resource instead of re-uploading. This is what prevents duplicate videos on retry.
4. Metadata:
   ```json
   { "snippet": { "title": "...", "description": "...", "tags": ["..."], "categoryId": "22" },
     "status":  { "privacyStatus": "private", "selfDeclaredMadeForKids": false } }
   ```
5. On success: store `yt_video_id`, `published_at`, status `PUBLISHED`.
6. Thumbnail: if `thumb_key` exists, call `thumbnails.set`. On failure store `yt_thumb_error` (non-fatal).

### 13.3 Error handling
| Condition | Action |
|---|---|
| Network error, 5xx | Retry (resume the session) |
| `quotaExceeded` | No retry. `PUBLISH_FAILED` / `YT_QUOTA`. Message: "Daily API quota reached, try tomorrow." |
| `uploadLimitExceeded` | No retry. `YT_UPLOAD_LIMIT`. This is the **channel's** daily upload cap, separate from API quota. |
| `invalid_grant`, 401 | `YT_AUTH_EXPIRED`, `needs_reconnect = true` |
| 400 invalid metadata | `YT_REJECTED` with Google's message |
| Ambiguous failure after all bytes sent and session cannot be queried | `PUBLISH_FAILED` with message "Check your channel before retrying" (never auto-retry) |

### 13.4 Known platform constraints (show these in the UI / README)
- A Google Cloud project created after 28 July 2020 that has **not passed YouTube's API compliance audit** has every upload forced to `private`, regardless of `privacyStatus`. The upload still succeeds and returns an id. The owner then makes it public in YouTube Studio, or completes the audit. Show an info banner on the Settings page: "Uploads may be forced private until your API project is audited."
- Upload quota numbers have changed over time and sources disagree. Do not hard-code them. Check the project's quota page in Google Cloud Console. Handle `quotaExceeded` / `uploadLimitExceeded` gracefully as above.
- YouTube classifies a Short automatically (vertical, short duration). There is no API flag for it.

---

## 14. HTTP API (Fastify, all under `/api`)

All routes except `POST /api/auth/login`, `GET /api/health` and the OAuth callback require a valid session. Request/response bodies validated with `zod`. Errors use a single shape: `{ "error": { "code": "...", "message": "..." } }`.

### Auth
- `POST /api/auth/login` `{password}`: constant-time compare with `ADMIN_PASSWORD`. Set cookie `session` = HMAC-signed token `{iat, exp}` using `SESSION_SECRET`; `httpOnly`, `secure` (in production), `sameSite=strict`, 7-day expiry. Rate limit: 5 attempts/min per IP (Redis counter).
- `POST /api/auth/logout`, `GET /api/auth/me`.

### Videos
- `POST /api/videos` `{url, templateId?}` -> `202 {id}`. Validates URL, disk guard, creates row, enqueues `download`. Returns a `duplicateOf` hint if the same `source_video_id` exists.
- `POST /api/videos/upload` (multipart, streamed to `tmp`, size limit `MAX_UPLOAD_SIZE_MB`) -> `202 {id}`.
- `GET /api/videos` (paginated, newest first) / `GET /api/videos/:id` (includes clips and last 50 events).
- `POST /api/videos/:id/cancel`, `POST /api/videos/:id/retry` (re-enqueue the failed stage), `DELETE /api/videos/:id` (deletes files and rows; refuses while a clip is `UPLOADING`).

### Clips
- `GET /api/clips/:id`
- `PATCH /api/clips/:id` `{ytTitle?, ytDescription?, ytTags?, ytPrivacy?}`: allowed only in `READY` or `PUBLISH_FAILED`; re-run the sanitizer server-side.
- `POST /api/clips/:id/approve`: allowed only in `READY` or `PUBLISH_FAILED`; requires a connected YouTube account; sets `APPROVED`, then `PUBLISH_QUEUED` and enqueues `publish` (single step, uses `jobId = publish:{clipId}`).
- `POST /api/clips/:id/reject`
- `POST /api/clips/:id/regenerate-metadata` (P1)
- `GET /api/clips/:id/video` and `/thumbnail`: authenticated streaming with Range support.

### YouTube / System / Templates
- `GET /api/youtube/status`, `GET /api/youtube/connect`, `GET /api/youtube/callback`, `DELETE /api/youtube` (disconnect).
- `GET /api/system/stats`: disk usage, queue counts, Ollama status, tool versions (ffmpeg, yt-dlp, faster-whisper), failure rate for the last 7/30 days.
- `GET /api/templates`, `GET /api/health`.

All state transitions are validated centrally (a `canTransition(from, to)` table); an invalid transition returns `409`.

---

## 15. Web UI (Next.js)

Pages:
- `/login`
- `/` Videos list: thumbnail, title, status badge, progress bar, created time.
- `/new` Tabs: "YouTube link" and "Upload file"; template select; disk-free indicator.
- `/videos/[id]` Stage stepper, progress, event log, clip grid, Retry / Cancel / Delete.
- `/clips/[id]` Review page: video player (9:16), thumbnail, title option picker, editable title/description/tags, privacy select, character counters for YouTube limits, **Approve & Publish**, **Reject**, **Regenerate metadata**, and a link to the YouTube video once published.
- `/settings` YouTube connect / disconnect / status, default privacy, default template, audit banner.
- `/system` Disk bar, queue depths, Ollama status, tool versions, failure rate.

UI rules:
- Poll with TanStack Query every 2 s while a video is processing, 15 s otherwise.
- Disable Approve when YouTube is not connected or the clip is not in an approvable state. Show the exact reason.
- Show `error_message` and a hint for known codes (for example `DOWNLOAD_BLOCKED` -> "upload the file instead").
- Responsive layout (usable on a phone for approving clips).

---

## 16. Security

- Dashboard is publicly reachable on the VPS and holds the YouTube token, so **auth is mandatory** even though there is one user.
- TLS via Caddy. Redis, PostgreSQL and Ollama listen only on the Docker network, never on public ports.
- URL allowlist for sources. Reject anything else (prevents SSRF).
- No shell string execution anywhere. All inputs to child processes are argument arrays; IDs only, never raw user text, in file paths.
- Uploads: stream to disk, enforce size limit, validate with `ffprobe` (not by extension/MIME alone).
- Encrypt the refresh token at rest. Never log tokens, cookies, or the admin password. Redact in the logger.
- Security headers (`helmet`), `sameSite=strict` cookie, JSON-only state-changing endpoints.
- `OAuth state` verified on callback.

---

## 17. Observability

- `pino` structured JSON logs; every log line in workers includes `videoId`, `clipId`, `stage`, `jobId`.
- `job_events` rows power the per-video timeline in the UI.
- `/api/system/stats` is the only dashboard needed (no Prometheus/Grafana/Sentry in v1).
- **Failure KPI** = `FAILED` videos with `error_category = SYSTEM` divided by all videos that were not cancelled, over the last 30 days. Target <= 5%. Report `USER_INPUT` and `EXTERNAL` failures separately.

---

## 18. Error model and reliability

Every failure has `code`, `category`, `retryable`.

| Code | Category | Retryable |
|---|---|---|
| URL_INVALID | USER_INPUT | no |
| VIDEO_UNAVAILABLE (private, age-gated, removed, geo) | USER_INPUT | no |
| VIDEO_TOO_LONG | USER_INPUT | no |
| NO_SPEECH | USER_INPUT | no |
| DISK_LOW | SYSTEM | no (user must free space) |
| DOWNLOAD_BLOCKED | EXTERNAL | yes, then suggest upload |
| MEDIA_CORRUPT | USER_INPUT | no |
| TRANSCRIBE_FAILED | SYSTEM | yes |
| NO_CLIPS | SYSTEM | no |
| RENDER_FAILED | SYSTEM | yes |
| LLM_FAILED | (non-fatal, falls back) | n/a |
| YT_AUTH_EXPIRED | EXTERNAL | no |
| YT_QUOTA / YT_UPLOAD_LIMIT | EXTERNAL | no |
| YT_REJECTED | EXTERNAL | no |
| YT_NETWORK | EXTERNAL | yes |

Reliability rules:
- LLM failure never fails the pipeline. Heuristic fallback always exists.
- Thumbnail failure never fails a clip.
- One failed clip render never fails the whole video if others succeed.
- On worker/container restart, in-flight jobs resume via BullMQ stalled-job handling; DB is the source of truth.
- Each stage writes outputs to temp then atomically renames, so a crash never leaves a half-written file under a final key.
- On startup, a `reconcile()` task re-enqueues videos stuck in a non-terminal status without an active job.

---

## 19. Deployment (`docker-compose.yml`)

Services: `postgres`, `redis`, `ollama`, `server-api`, `server-worker`, `web`, `caddy`.

- `server-*` image (`Dockerfile.server`): `node:20-bookworm-slim` + `ffmpeg`, `python3`, `python3-venv`, `fontconfig`, fonts; a venv with `faster-whisper`, `numpy`, and `yt-dlp` (installed via pip so it can be upgraded). Copy `assets/fonts` and run `fc-cache`. `server-api` and `server-worker` share the image with different commands (`entry-api.js` / `entry-worker.js`).
- Volumes: `pgdata`, `redisdata` (AOF on), `ollama` (models), `appdata` mounted at `/data` (videos, clips, models, tmp) in both api and worker containers.
- `ollama` first-run: a one-shot `ollama pull ${OLLAMA_MODEL}` documented in README and in a `scripts/bootstrap.sh`. Same for the Whisper model download.
- Healthchecks on postgres, redis, and `/api/health`.
- `restart: unless-stopped` for all services.
- Provide `README.md` with: VPS sizing, bootstrap steps, Google Cloud OAuth setup (create project, enable YouTube Data API v3, OAuth client of type Web, add redirect URI, set consent screen to In production), Figma export steps for `overlay.png`, and backup notes (`pg_dump` cron).

---

## 20. Figma template workflow (document in README)

1. Create a 1080x1920 frame in Figma. Place a rectangle where the video should appear.
2. Export the frame as PNG with that rectangle area **transparent** (hide the rectangle layer or use a mask). Save as `assets/templates/<id>/overlay.png`.
3. Copy the rectangle's `x, y, width, height` into `layout.json` under `slot`.
4. Design the caption position and copy `x, y` into `caption`.
5. Optional: same for `thumb_overlay.png`.

---

## 21. Testing

- **Unit** (Vitest): `sentences`, `candidates`, `scoring`, `select`, `captions-ass`, `ffmpeg-args` (snapshots), `metadata-sanitize` (limits, forbidden chars), `canTransition`, `crypto` (round trip), `local storage` (path traversal rejected).
- **Integration** (with Docker services): a smoke script `scripts/smoke.ts <file>` runs upload -> transcribe -> analyze -> render on a short real speech file and asserts clips exist with correct duration/resolution.
- Render test using a synthetic `lavfi` clip (Section 12.2).
- Fallback tests: run the analyze stage with `OLLAMA_DISABLED=true` and with a mocked invalid LLM response; both must produce clips.
- Publish test with `YT_DRY_RUN=true`; assert payload limits and idempotency (second `publish` job for the same clip is a no-op).
- API tests: auth required, invalid transitions return 409, upload size limit enforced.

---

## 22. Build phases (do in order)

**Phase 1: Foundation.** Monorepo, config + zod validation, logger, Prisma schema + migration, Redis/BullMQ setup, `StorageProvider` + `LocalStorage` (with tests), disk guard, Docker Compose for postgres/redis, `.env.example`.
*Accept:* app boots, bad env fails fast, storage tests pass, migration applies.

**Phase 2: Auth + API skeleton.** Login/logout/me, session plugin, error handler, `/api/health`, `canTransition`, videos CRUD (without processing).
*Accept:* protected routes return 401 without a cookie; login rate limit works.

**Phase 3: Ingest.** `POST /api/videos`, upload endpoint, download worker (yt-dlp, ffprobe, audio extract), progress, events, cancel, error mapping.
*Accept:* a real short YouTube link and an uploaded file both reach `TRANSCRIBING`; too-long video rejected; blocked/private errors mapped.

**Phase 4: Transcription.** `transcribe.py`, whisper wrapper, `heavy` semaphore, transcript storage.
*Accept:* transcript with word timestamps + energy saved; `NO_SPEECH` handled.

**Phase 5: Highlight engine (no LLM).** `sentences`, `candidates`, `scoring`, `select`, analyze worker using heuristics only, clip rows created.
*Accept:* N non-overlapping clips of 30-55 s on a sample; unit tests green.

**Phase 6: Render.** Template loader, ASS captions, FFmpeg builder, render worker, `ffprobe` validation, video `READY` logic.
*Accept:* playable 1080x1920 MP4 with overlay and captions; fan-out/fan-in correct.

**Phase 7: Ollama + metadata.** Ollama client, re-rank, metadata generation, sanitizer, fallbacks, regenerate endpoint.
*Accept:* works with Ollama up, down (`OLLAMA_DISABLED=true`), and with invalid JSON responses.

**Phase 8: Thumbnails.** Frame sampling, sharpness scoring, composition.
*Accept:* JPEG < 2 MB produced per clip; failures do not break render.

**Phase 9: Dashboard.** All pages in Section 15, polling, review/edit/approve UI (approve calls API; publish can still be dry-run).
*Accept:* full flow works in the browser end to end with `YT_DRY_RUN=true`.

**Phase 10: YouTube.** OAuth connect, encrypted token storage, resumable upload with persisted session, thumbnail set, error mapping, banner for private-upload rule.
*Accept:* a real clip uploads to the owner's channel; killing the worker mid-upload and restarting resumes without a duplicate.

**Phase 11: Hardening.** Maintenance worker (retention, tmp cleanup, yt-dlp update), `reconcile()`, `/system` page, failure KPI, security headers, Caddy TLS config, README, backup notes.
*Accept:* retention deletes expected files only; disk guard blocks new jobs at threshold; stats page accurate.

**Phase 12 (P2, only if everything above is done):** F16, F17, F18, F19, F20.

---

## 23. Definition of done

- All P0 and P1 features work end to end on a fresh VPS using `docker compose up` plus the documented bootstrap steps.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.
- With Ollama stopped, a video still produces clips with fallback metadata.
- A full 30-minute test video completes without exceeding memory on an 8 GB VPS (heavy semaphore verified).
- Killing and restarting the worker during any stage does not lose or duplicate work.
- Secrets are not committed; `.env.example` is complete.

---

## 24. Known limitations (keep in README)

- yt-dlp may be blocked from datacenter IPs; the upload path is the guaranteed fallback.
- Heuristic + small local LLM picks decent, not perfect, highlights. Quality scales with a larger Ollama model (`OLLAMA_MODEL=qwen2.5:7b`) at the cost of speed and RAM.
- CPU-only transcription of a 1-hour video can take tens of minutes depending on vCPU count.
- Local-disk storage means a single VPS. Moving to multiple servers requires implementing another `StorageProvider` (for example S3/MinIO).
- Unverified Google Cloud projects have uploads forced to private until audited.
- Whisper accuracy for Bangla is lower than for English; captions may need manual review.
