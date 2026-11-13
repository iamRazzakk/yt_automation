# Decisions

- Use top-level `backend/` and `frontend/` instead of `apps/server` and `apps/web` (operator request).
- Package manager: pnpm workspaces at repo root.
- Node target: 20+ (local Node 24 OK for development).
- Host Postgres mapped to `localhost:5433` to avoid conflict with other local Postgres on 5432.
- Default template uses `image.png` (rixnet frame): video slot `24,250,1032x1240`, corner radius 72; run `node backend/scripts/build-template-overlay.mjs` to rebuild `overlay.png` / `thumb_overlay.png`; background `color` black.
- BullMQ job ids use `stage-entityId` (not `stage:entityId`) because BullMQ forbids `:`.
- Local `STORAGE_ROOT` points at `C:/Users/rakib/AppData/Local/shorts-studio/data` because `D:` only has ~2 GB free while the repo lives on `D:`.
- Render audio: after loudnorm, apply a gentle volume sine pulse (±10%, period 4.5s) so voice level subtly rises/falls every 4–5s.
- YouTube submit normalizes any allowed host/form (youtu.be?si=, shorts, embed, live) to `https://www.youtube.com/watch?v=ID` before queueing download.
- Transcribe: if VAD+word_timestamps yields 0 words, retry without VAD and/or synthesize word timings from segment text.
