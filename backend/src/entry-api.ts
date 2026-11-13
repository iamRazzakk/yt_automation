import { mkdir } from "node:fs/promises";
import { buildApp } from "./api/app.js";
import { loadConfig } from "./infra/config.js";
import { installBigIntJson } from "./infra/json.js";
import { createLogger } from "./infra/logger.js";

installBigIntJson();

const log = createLogger("api");

async function main() {
  const cfg = loadConfig();
  await mkdir(cfg.STORAGE_ROOT, { recursive: true });
  const app = await buildApp();
  await app.listen({ port: cfg.API_PORT, host: "0.0.0.0" });
  log.info({ port: cfg.API_PORT }, "API listening");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
