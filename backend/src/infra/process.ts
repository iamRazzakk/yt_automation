import { spawn } from "node:child_process";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

/**
 * Spawn a process with an args array (never shell). Kill tree on timeout.
 */
export function runCommand(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 5000).unref();
      }, opts.timeoutMs);
    }

    child.stdout?.on("data", (buf: Buffer) => {
      const s = buf.toString();
      stdout += s;
      opts.onStdout?.(s);
    });
    child.stderr?.on("data", (buf: Buffer) => {
      const s = buf.toString();
      stderr += s;
      opts.onStderr?.(s);
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(Object.assign(new Error(`Command timed out: ${cmd}`), { stdout, stderr }));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}
