import pino from "pino";
import { loadConfig } from "./config.js";

const REDACT_PATHS = [
  "password",
  "adminPassword",
  "ADMIN_PASSWORD",
  "cookie",
  "cookies",
  "authorization",
  "refreshToken",
  "refresh_token",
  "refreshTokenEnc",
  "SESSION_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "GOOGLE_CLIENT_SECRET",
];

export function createLogger(name?: string) {
  const cfg = loadConfig();
  const opts: pino.LoggerOptions = {
    level: cfg.NODE_ENV === "test" ? "silent" : "info",
    redact: {
      paths: REDACT_PATHS,
      censor: "[Redacted]",
    },
  };
  if (name) opts.name = name;
  if (cfg.NODE_ENV === "development") {
    opts.transport = { target: "pino-pretty", options: { colorize: true } };
  }
  return pino(opts);
}

export type Logger = ReturnType<typeof createLogger>;
