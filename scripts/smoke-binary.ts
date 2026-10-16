/**
 * Compiles the standalone binary for this machine and runs it the way agents do: through pipes, from a temporary
 * repository, writing the report to folders that do not exist yet. CI runs it on Linux, macOS and Windows, so each
 * release binary has run on its own system before it ships.
 *
 *   bun scripts/smoke-binary.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION } from "../src/core/constants.ts";
import { ensureDir } from "../src/core/fs.ts";
import { buildAssets, compileBinary } from "./build.ts";
import { GIT_ENV } from "./build-examples.ts";

const tmp = mkdtempSync(join(tmpdir(), "explain-change-smoke-"));
const bin = join(tmp, process.platform === "win32" ? "explain-change.exe" : "explain-change");
const repo = join(tmp, "repo");
const env = { ...process.env, ...GIT_ENV };

function run(cmd: string, args: string[]) {
  const p = spawnSync(cmd, args, { cwd: repo, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (p.error) throw p.error;
  return { status: p.status, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
}

function git(...args: string[]): void {
  const r = run("git", args);
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed\n${r.stderr}`);
}

function expect(ok: boolean, what: string, detail: unknown): void {
  if (!ok) throw new Error(`${what}\n${typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)}`);
  console.log(`ok  ${what}`);
}

/** Its stdout as JSON: a cut-short write fails here. */
function json(args: string[]) {
  const r = run(bin, args);
  try {
    return { ...r, value: JSON.parse(r.stdout) };
  } catch {
    throw new Error(
      `explain-change ${args.join(" ")}: stdout is not complete JSON (exit ${r.status})\n${r.stdout.slice(-400)}${r.stderr}`,
    );
  }
}

try {
  await buildAssets();
  compileBinary(bin);
  ensureDir(join(repo, "app", "models"));

  const version = run(bin, ["--version"]);
  expect(version.stdout.startsWith(`explain-change ${VERSION} `), `--version prints ${VERSION}`, version);

  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "base");
  git("checkout", "-qb", "feature");
  writeFileSync(join(repo, "app", "models", "order.rb"), "class Order\nend\n");
  git("add", "-A");
  git("commit", "-qm", "Add orders");

  const out = join(tmp, "new", "folders", "report.html");
  const local = json(["local", "--base", "main", "--no-open", "--json", "--out", out]);
  expect(local.status === 0 && local.value.change.files === 1, "local --json explains the change", local);
  expect(existsSync(out), "the report is written to new folders", local.value.paths);

  const again = json(["local", "--base", "main", "--no-open", "--json"]);
  expect(again.status === 0, "a second run reuses the existing work folder", again);

  const schema = json(["schema", "facts"]);
  expect(
    schema.status === 0 && schema.value.$schema?.includes("2020-12"),
    "schema facts prints all of it",
    schema.status,
  );

  const bad = run(bin, ["schema", "nope"]);
  expect(bad.status === 2 && bad.stderr.endsWith("\n"), "a usage error exits 2 with its whole message", bad);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
