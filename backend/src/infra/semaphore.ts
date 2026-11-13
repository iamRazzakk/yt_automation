import { getRedis } from "./redis.js";
import { loadConfig } from "./config.js";

const KEY = "semaphore:heavy";

/**
 * Redis-backed counting semaphore for heavy RAM work (Whisper / Ollama).
 */
export async function acquireHeavy(
  holderId: string,
  timeoutMs = 30 * 60_000,
): Promise<() => Promise<void>> {
  const redis = getRedis();
  const { HEAVY_SLOTS } = loadConfig();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const n = await redis.scard(KEY);
    if (n < HEAVY_SLOTS) {
      const added = await redis.sadd(KEY, holderId);
      if (added === 1) {
        await redis.expire(KEY, Math.ceil(timeoutMs / 1000) + 60);
        return async () => {
          await redis.srem(KEY, holderId);
        };
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Timed out waiting for heavy semaphore");
}
