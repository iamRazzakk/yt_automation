import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { loadConfig } from "../infra/config.js";
import { getRedis } from "../infra/redis.js";
import { initStorage } from "../infra/storage/local.js";
import { authPlugin } from "./plugins/auth.js";
import { errorPlugin } from "./plugins/errors.js";
import { authRoutes } from "./routes/auth.js";
import { clipRoutes } from "./routes/clips.js";
import { healthRoutes } from "./routes/health.js";
import { settingsRoutes } from "./routes/settings.js";
import { systemRoutes } from "./routes/system.js";
import { templateRoutes } from "./routes/templates.js";
import { uploadRoutes } from "./routes/upload.js";
import { videoRoutes } from "./routes/videos.js";
import { youtubeRoutes } from "./routes/youtube.js";

export async function buildApp() {
  const cfg = loadConfig();
  initStorage(cfg.STORAGE_ROOT);

  const app = Fastify({
    logger: true,
    trustProxy: true,
  });

  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: cfg.APP_URL,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: cfg.MAX_UPLOAD_SIZE_MB * 1024 * 1024 },
  });
  await app.register(rateLimit, {
    global: false,
    redis: getRedis(),
  });

  await errorPlugin(app);
  await authPlugin(app);

  await healthRoutes(app);
  await authRoutes(app);
  await videoRoutes(app);
  await uploadRoutes(app);
  await clipRoutes(app);
  await youtubeRoutes(app);
  await settingsRoutes(app);
  await systemRoutes(app);
  await templateRoutes(app);

  return app;
}
