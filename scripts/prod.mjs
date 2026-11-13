import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const services = [
  {
    name: "api",
    command: "pnpm --filter @shorts-studio/backend exec tsx src/entry-api.ts",
  },
  {
    name: "worker",
    command: "pnpm --filter @shorts-studio/backend exec tsx src/entry-worker.ts",
  },
  {
    name: "web",
    command: "pnpm --filter @shorts-studio/frontend exec next start -H 0.0.0.0 -p 9999",
  },
];

const children = services.map(({ name, command }) => {
  const child = spawn(command, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      NODE_ENV: "production",
      API_URL: process.env.API_URL ?? "http://127.0.0.1:4000",
    },
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
