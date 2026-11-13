import { Redis } from "ioredis";
import { loadConfig } from "./config.js";

let connection: Redis | null = null;

export function getRedis(): Redis {
  if (!connection) {
    const { REDIS_URL } = loadConfig();
    connection = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
    });
  }
  return connection;
}

export async function disconnectRedis(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
