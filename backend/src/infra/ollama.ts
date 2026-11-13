import { z } from "zod";
import { loadConfig } from "./config.js";

const rerankSchema = z.object({
  scores: z.array(
    z.object({
      id: z.number().int(),
      score: z.number().int().min(1).max(10),
      reason: z.string().max(80),
    }),
  ),
});

const metaSchema = z.object({
  titles: z.array(z.string()).min(1).max(5),
  description: z.string(),
  tags: z.array(z.string()),
  hook: z.string(),
});

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

async function chatJson<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
  format: Record<string, unknown>,
): Promise<T> {
  const cfg = loadConfig();
  const body = {
    model: cfg.OLLAMA_MODEL,
    stream: false,
    keep_alive: "30s",
    format,
    options: { temperature: 0.2, num_ctx: 4096 },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  const attempt = async (extra?: string) => {
    const res = await fetch(`${cfg.OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...body,
        messages: extra
          ? [
              ...body.messages,
              { role: "user", content: extra },
            ]
          : body.messages,
      }),
      signal: AbortSignal.timeout(cfg.OLLAMA_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new LlmError(`Ollama HTTP ${res.status}`);
    }
    const data = (await res.json()) as { message?: { content?: string } };
    const content = data.message?.content ?? "";
    const parsed = schema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      throw new LlmError("Invalid LLM JSON");
    }
    return parsed.data;
  };

  try {
    return await attempt();
  } catch {
    return await attempt("Return only valid JSON matching the schema.");
  }
}

export async function rerankCandidates(
  candidates: Array<{ id: number; text: string }>,
): Promise<Array<{ id: number; score: number; reason: string }>> {
  const batches: Array<Array<{ id: number; text: string }>> = [];
  for (let i = 0; i < candidates.length; i += 8) {
    batches.push(candidates.slice(i, i + 8));
  }
  const all: Array<{ id: number; score: number; reason: string }> = [];
  for (const batch of batches) {
    const result = await chatJson(
      "You pick the peak moments from a long video for Shorts — the parts people would most replay or share. Prefer high energy, clear hooks, surprising or emotional beats, and self-contained meaning. Reasons must be English. Score 1-10.",
      `Candidates: ${JSON.stringify(batch)}`,
      rerankSchema,
      {
        type: "object",
        properties: {
          scores: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "integer" },
                score: { type: "integer" },
                reason: { type: "string" },
              },
              required: ["id", "score", "reason"],
            },
          },
        },
        required: ["scores"],
      },
    );
    all.push(...result.scores);
  }
  return all;
}

export async function generateClipMetadata(clipText: string): Promise<{
  titles: string[];
  description: string;
  tags: string[];
  hook: string;
}> {
  return chatJson(
    [
      "Generate YouTube Shorts metadata in English only.",
      "Titles, description, tags, and hook must be English — never Bangla or other languages.",
      "Even if the transcript is not English, translate the meaning into natural English.",
      "Return:",
      "1) 3 punchy title options (max ~70 chars, no hashtags in titles).",
      "2) A detailed description (3–6 sentences, ~400–900 characters): open with what happens in the clip, explain the key point or tip, why it matters, and a soft CTA to watch/like/follow. Use plain language. Do NOT just repeat the title. End ready for #Shorts hashtags.",
      "3) 8–12 specific English tags from the content (not generic spam only).",
      "4) A short on-screen hook (<=6 words).",
    ].join(" "),
    clipText,
    metaSchema,
    {
      type: "object",
      properties: {
        titles: { type: "array", items: { type: "string" } },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        hook: { type: "string" },
      },
      required: ["titles", "description", "tags", "hook"],
    },
  );
}
