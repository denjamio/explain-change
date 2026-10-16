/**
 * Evaluates the skill end to end: a real agent explains each scenario, and the result is measured. Costs tokens.
 *
 *   bun scripts/eval.ts [--model haiku|sonnet|opus] [--agent "claude -p"] [scenario…]
 *
 * For each scenario (examples/scenarios/<name>): its git repository is built in a temp folder, `explain-change` (this
 * checkout) is put on PATH, and the agent gets the user's request plus skills/explain-change/PROMPT.md. Then
 * `explain-change status --json` says whether the explanation is valid. Reported per scenario: the final state, the
 * issues left, the agent's turns, cost and time (from `claude -p --output-format json`).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { parseArgs } from "node:util";
import { removeTree } from "../src/core/fs.ts";
import { buildAssets } from "./build.ts";
import { buildScenarioRepo, GIT_ENV, scenarioNames } from "./build-examples.ts";

const ROOT = join(import.meta.dir, "..");
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: { model: { type: "string", default: "sonnet" }, agent: { type: "string", default: "claude -p" } },
  allowPositionals: true,
});
const REQUEST = "Explain the changes of this branch with explain-change.";

await buildAssets();
const tmp = mkdtempSync(join(tmpdir(), "explain-change-eval-"));
const bin = join(tmp, "bin");
mkdirSync(bin);
const shim = join(bin, "explain-change");
writeFileSync(shim, `#!/bin/sh\nexec bun "${join(ROOT, "src/cli/bin.ts")}" "$@"\n`);
chmodSync(shim, 0o755);
const env = { ...process.env, ...GIT_ENV, PATH: `${bin}${delimiter}${process.env.PATH}` };
const prompt = readFileSync(join(ROOT, "skills/explain-change/PROMPT.md"), "utf8");

const rows: Record<string, unknown>[] = [];
try {
  for (const name of positionals.length ? positionals : scenarioNames()) {
    const repo = buildScenarioRepo(name, tmp);
    const [cmd, ...args] = (values.agent as string).split(" ");
    const started = Date.now();
    const run = spawnSync(
      cmd as string,
      [
        ...args,
        REQUEST,
        "--model",
        values.model as string,
        "--output-format",
        "json",
        "--append-system-prompt",
        prompt,
        "--allowedTools",
        "Bash(explain-change:*)",
        "Read",
        "Edit",
        "Write",
      ],
      { cwd: repo, env, encoding: "utf8", timeout: 15 * 60_000 },
    );
    let agent: { num_turns?: number; total_cost_usd?: number } = {};
    try {
      agent = JSON.parse(run.stdout);
    } catch {
      // not claude's JSON: only the outcome is measured
    }
    const status = spawnSync("bun", [join(ROOT, "src/cli/bin.ts"), "status", "--json"], {
      cwd: repo,
      env,
      encoding: "utf8",
    });
    const out = JSON.parse(status.stdout || "{}");
    rows.push({
      scenario: name,
      state: out.explanation?.state ?? "error",
      issues: out.explanation?.issues?.length ?? null,
      turns: agent.num_turns ?? null,
      costUsd: agent.total_cost_usd ?? null,
      seconds: Math.round((Date.now() - started) / 1000),
    });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }
} finally {
  removeTree(tmp);
}
const valid = rows.filter((r) => r.state === "valid").length;
console.log(`\n${valid}/${rows.length} valid with ${values.model}`);
process.exitCode = valid === rows.length ? 0 : 1;
