import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const services = [
  { name: "api", command: "pnpm --filter @shorts-studio/backend dev:api" },
  { name: "worker", command: "pnpm --filter @shorts-studio/backend dev:worker" },
  { name: "web", command: "pnpm --filter @shorts-studio/frontend dev" },
];

const children = services.map(({ name, command }) => {
  const child = spawn(command, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (signal) {
      console.error(`[${name}] killed (${signal})`);
    } else if (code !== 0 && code !== null) {
      console.error(`[${name}] exited with code ${code}`);
    }
    shutdown(code ?? 1);
  });
  return child;
});

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
