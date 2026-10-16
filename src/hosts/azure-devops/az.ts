import { spawnSync } from "node:child_process";
import { AZ_TIMEOUT_MS, LOGIN_TIMEOUT_MS } from "../../core/constants.ts";
import { type RunResult, runProgram, which } from "../../core/proc.ts";

export const AZ_SETUP = "install the az CLI, then `az extension add --name azure-devops` and `az login`";

/** An az call's result, or why it could not run. */
export type AzResult = RunResult | { error: string };

/** The az CLI. Tests replace `call` and `login`; everything else goes through them. */
export class Az {
  private loginTried = false;

  /** Runs az once. */
  call(args: string[], cwd: string): AzResult {
    const az = which("az");
    if (!az) return { error: "az CLI not found" };
    const r = runProgram(az, args, { cwd, timeoutMs: AZ_TIMEOUT_MS });
    return r === "timeout" ? { error: `az timed out after ${AZ_TIMEOUT_MS / 1000}s` } : r;
  }

  /**
   * Runs `az login` in the user's terminal and browser, at most once per command. Its output goes to stderr, so a
   * device code shows too.
   */
  login(cwd: string): boolean {
    const az = which("az");
    if (!az || this.loginTried) return false;
    this.loginTried = true;
    process.stderr.write("explain-change: az has no valid session; running `az login`…\n");
    const p = spawnSync(az, ["login", "--allow-no-subscriptions", "--only-show-errors", "-o", "none"], {
      cwd,
      env: { ...process.env, AZURE_CORE_LOGIN_EXPERIENCE_V2: "off" }, // no subscription picker to answer
      stdio: ["inherit", 2, "inherit"],
      timeout: LOGIN_TIMEOUT_MS,
      shell: process.platform === "win32",
    });
    return !p.error && p.status === 0;
  }

  /** `call`, logging in and retrying once when az has no valid session. */
  run(args: string[], cwd: string): AzResult {
    let r = this.call(args, cwd);
    if (!("error" in r) && r.status !== 0 && needsLogin(r.stderr) && this.login(cwd)) r = this.call(args, cwd);
    return r;
  }
}

export function needsLogin(stderr: string): boolean {
  const low = stderr.toLowerCase();
  return (
    ["az login", "aadsts", "credentials", "unauthorized", "expired"].some((w) => low.includes(w)) ||
    /(?<![\w])401(?![\w])/.test(low) // not inside ADO codes like TF401180
  );
}

/** az's error, with the fix for the usual causes. */
export function azHint(stderr: string): string {
  const low = stderr.toLowerCase();
  if (low.includes("azure-devops") || low.includes("misspelled or not recognized")) {
    return "the azure-devops extension is missing: run `az extension add --name azure-devops`";
  }
  if (needsLogin(stderr)) return "not logged in: run `az login`";
  if (low.includes("organization")) {
    return "no organization detected from the git remote: run `az devops configure --defaults organization=https://dev.azure.com/<org>`";
  }
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.toLowerCase().startsWith("warning"));
  return lines[0]?.slice(0, 200) ?? "unknown error";
}
