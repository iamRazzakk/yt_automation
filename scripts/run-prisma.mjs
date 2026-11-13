import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node scripts/run-prisma.mjs <prisma args…>");
  process.exit(2);
}

const command = ["pnpm", "--filter", "@shorts-studio/backend", "exec", "prisma", ...args]
  .map((part) => (/[\s"]/.test(part) ? `"${part.replaceAll('"', '\\"')}"` : part))
  .join(" ");

const child = spawn(command, {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 1));
