import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { UnrecoverableError } from "bullmq";
import { generateCandidates } from "../domain/candidates.js";
import { ErrorCatalog, makeError } from "../domain/errors.js";
import {
  generateFallbackMetadata,
  sanitizeMetadata,
} from "../domain/metadata-sanitize.js";
import { scoreCandidates } from "../domain/scoring.js";
import { selectNonOverlapping } from "../domain/select.js";
import { buildSentences, type Word } from "../domain/sentences.js";
import { loadConfig } from "../infra/config.js";
import { getDb } from "../infra/db.js";
import { createLogger } from "../infra/logger.js";
import { rerankCandidates, generateClipMetadata } from "../infra/ollama.js";
import { enqueueJob } from "../infra/queues.js";
import { acquireHeavy } from "../infra/semaphore.js";

const log = createLogger("worker-analyze");

interface TranscriptData {
  duration?: number;
  segments: Array<{ words?: Word[] }>;
  energy?: { hop: number; rms: number[] };
}

export async function processAnalyze(job: {
  data: { videoId: string };
}): Promise<void> {
  const { videoId } = job.data;
  const cfg = loadConfig();
  const db = getDb();

  try {
    const video = await db.video.findUnique({ where: { id: videoId } });
    if (!video) throw new UnrecoverableError("Video not found");
    if (video.status === "CANCELLED") return;

    const existingClips = await db.clip.count({ where: { videoId } });
    if (existingClips > 0) {
      return;
    }

    await db.video.update({
      where: { id: videoId },
      data: { status: "ANALYZING", progress: 10, stageDetail: "Finding highlights" },
    });

    const transcript = await db.transcript.findUnique({ where: { videoId } });
    if (!transcript) throw new UnrecoverableError("Missing transcript");

    const data = transcript.data as unknown as TranscriptData;
    const words: Word[] = data.segments.flatMap((s) => s.words ?? []);
    const sentences = buildSentences(words);
    const mediaDuration = data.duration ?? video.durationSec ?? words.at(-1)?.end ?? 0;
    const energy = data.energy ?? { hop: 1, rms: [] };

    const lexiconPath = join(process.cwd(), "..", "assets", "lexicon.en.json");
    const lexicon = JSON.parse(await readFile(lexiconPath, "utf8")) as {
      hookPatterns: string[];
      stopwords: string[];
    };

    const candidates = generateCandidates(sentences, {
      clipMinSec: cfg.CLIP_MIN_SEC,
      clipMaxSec: cfg.CLIP_MAX_SEC,
      mediaDuration,
    });
    if (candidates.length === 0) {
      throw makeError(ErrorCatalog.NO_CLIPS, "No clip candidates found");
    }

    const scored = scoreCandidates(candidates, sentences, energy, lexicon);
    const preselected = selectNonOverlapping(
      scored.map((c) => ({ ...c, score: c.heuristicScore })),
      cfg.CLIPS_PER_VIDEO * 3,
    );

    let withFinal = preselected.map((c) => ({
      ...c,
      llmScore: null as number | null,
      finalScore: c.heuristicScore,
    }));

    if (!cfg.OLLAMA_DISABLED) {
      const release = await acquireHeavy(`analyze:${videoId}`);
      try {
        const llmScores = await rerankCandidates(
          preselected.map((c, i) => ({ id: i, text: c.text.slice(0, 900) })),
        );
        withFinal = preselected.map((c, i) => {
          const llm = llmScores.find((s) => s.id === i)?.score ?? null;
          const finalScore =
            llm === null
              ? c.heuristicScore
              : 0.5 * c.heuristicScore + 0.5 * (llm / 10);
          return { ...c, llmScore: llm, finalScore };
        });
      } catch (e) {
        log.warn({ videoId, err: e }, "LLM rerank failed, using heuristics");
        await db.jobEvent.create({
          data: {
            videoId,
            stage: "analyze",
            level: "warn",
            message: "Ollama rerank failed; using heuristic scores",
          },
        });
      } finally {
        await release();
      }
    }

    const selected = selectNonOverlapping(
      withFinal.map((c) => ({ ...c, score: c.finalScore })),
      cfg.CLIPS_PER_VIDEO,
    );
    if (selected.length === 0) {
      throw makeError(ErrorCatalog.NO_CLIPS, "No clips selected");
    }

    const privacy = cfg.YT_DEFAULT_PRIVACY;
    for (let idx = 0; idx < selected.length; idx++) {
      const c = selected[idx]!;
      let meta = generateFallbackMetadata(c.text);
      if (!cfg.OLLAMA_DISABLED) {
        try {
          const llmMeta = await generateClipMetadata(c.text.slice(0, 3500));
          meta = sanitizeMetadata(llmMeta);
        } catch {
          // fallback already set
        }
      }

      const clip = await db.clip.create({
        data: {
          videoId,
          idx,
          startSec: c.start,
          endSec: c.end,
          heuristicScore: c.heuristicScore,
          llmScore: c.llmScore,
          finalScore: c.finalScore,
          hookText: meta.hook,
          titleOptions: meta.titles,
          ytTitle: meta.titles[0]!,
          ytDescription: meta.description,
          ytTags: meta.tags,
          ytPrivacy: privacy,
          status: "RENDERING",
        },
      });
      await enqueueJob("render", clip.id, { clipId: clip.id, videoId });
    }

    await db.video.update({
      where: { id: videoId },
      data: {
        status: "RENDERING",
        progress: 0,
        stageDetail: `Rendering ${selected.length} clips`,
      },
    });
    await db.jobEvent.create({
      data: {
        videoId,
        stage: "analyze",
        level: "info",
        message: `Selected ${selected.length} clips`,
      },
    });
  } catch (e) {
    await fail(videoId, e);
    if (e && typeof e === "object" && "retryable" in e && !(e as { retryable: boolean }).retryable) {
      const msg = e instanceof Error ? e.message : "Unrecoverable analyze error";
      throw new UnrecoverableError(msg);
    }
    throw e;
  }
}

async function fail(videoId: string, e: unknown): Promise<void> {
  const db = getDb();
  const err = e as {
    code?: string;
    category?: "USER_INPUT" | "EXTERNAL" | "SYSTEM";
    message?: string;
  };
  log.error({ videoId, err: e }, "analyze failed");
  await db.video.update({
    where: { id: videoId },
    data: {
      status: "FAILED",
      errorCode: err.code ?? "NO_CLIPS",
      errorCategory: err.category ?? "SYSTEM",
      errorMessage: err.message ?? "Analyze failed",
    },
  });
  await db.jobEvent.create({
    data: {
      videoId,
      stage: "analyze",
      level: "error",
      message: err.message ?? "Analyze failed",
    },
  });
}
