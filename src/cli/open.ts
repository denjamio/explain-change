import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { which } from "../core/proc.ts";

export function inWsl(): boolean {
  try {
    return readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}

/** Never in CI, in tests (EXPLAIN_CHANGE_NO_OPEN=1) or with --no-open. */
export function shouldOpen(noOpen: boolean): boolean {
  return !noOpen && !process.env.CI && !process.env.EXPLAIN_CHANGE_NO_OPEN;
}

/** Opens the report in the default browser; from WSL, in the Windows one. Returns whether it launched one. */
export function openReport(path: string): boolean {
  const file = resolve(path);
  try {
    if (inWsl()) {
      // Linux browsers rarely exist there: Windows opens the file instead.
      const wslview = which("wslview");
      if (wslview) return launch(wslview, [file]);
      const win = spawnSync("wslpath", ["-w", file], { encoding: "utf8" });
      if (win.status !== 0) return false;
      return launch(which("explorer.exe") ?? "/mnt/c/Windows/explorer.exe", [win.stdout.trim()]);
    }
    const url = pathToFileURL(file).href;
    if (process.platform === "darwin") return launch("open", [url]);
    if (process.platform === "win32") return launch("cmd", ["/c", "start", '""', url]);
    const opener = which("xdg-open");
    return opener ? launch(opener, [url]) : false;
  } catch {
    return false;
  }
}

function launch(cmd: string, args: string[]): boolean {
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
  return true;
}
