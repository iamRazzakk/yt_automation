# Shorts Studio

Self-hosted pipeline: long YouTube video or upload → vertical Shorts with captions, metadata, and one-click YouTube publish.

## Layout

- `backend/` — Fastify API + BullMQ workers (TypeScript)
- `frontend/` — Next.js dashboard
- `assets/` — templates, fonts, lexicon
- `SPEC.md` — full product spec

## Quick start (dev)

1. Copy env and start infra:

```bash
cp .env.example .env
docker compose up -d
```

Infra: Postgres, Redis, and Ollama. First start also runs `ollama-init` to pull `OLLAMA_MODEL` (see `.env`). If port 11434 is busy, stop the host Ollama app or change `OLLAMA_PORT`.

2. Install and migrate:

```bash
pnpm install
pnpm prisma:generate
pnpm prisma:migrate
node backend/scripts/generate-overlays.mjs
```

3. Run API, worker, and web together:

```bash
pnpm run dev
```

(or `npm run dev` — same script)

- Dashboard: http://localhost:3000  
- API: http://localhost:4000/api/health  

To run one process alone: `pnpm dev:api` / `pnpm dev:worker` / `pnpm dev:web`.

No admin login — the dashboard is open. Protect the host/network if exposed publicly.

## Tools required on the host

- Node 20+
- FFmpeg / ffprobe
- yt-dlp
- Python 3 + `faster-whisper` + `numpy` (for transcription)
- Optional: Ollama with `qwen2.5:3b`

## YouTube OAuth

1. Create a Google Cloud project, enable **YouTube Data API v3**.
2. Create an OAuth client (Web), add redirect URI matching `GOOGLE_REDIRECT_URI`.
3. Set consent screen to **In production** (testing mode refresh tokens expire ~7 days).
4. Put client id/secret in `.env`. Keep `YT_DRY_RUN=true` until you are ready.

## Figma template

1. 1080×1920 frame; transparent hole where the video sits.
2. Export PNG → `assets/templates/<id>/overlay.png`.
3. Copy slot rect into `layout.json`.

## Notes

- Datacenter IPs may get yt-dlp blocked — use the upload path or cookies.
- Unverified API projects often force uploads to **private**.
- See `SPEC.md` for pipeline details and `DECISIONS.md` for deviations.
