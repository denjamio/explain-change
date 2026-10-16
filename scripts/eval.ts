/**
 * Evaluates the skill end to end: a real agent explains each scenario, and the result is measured. Costs tokens.
 *
 *   bun scripts/eval.ts [--model haiku|sonnet|opus] [--agent "claude -p"] [scenario…]
 *
 * For each scenario (examples/scenarios/<name>): its git repository is built in a temp folder, `explain-change` (this
 * checkout) is put on PATH, and the agent gets the user's request plus skills/explain-change/SKILL.md (the skill
 * itself, without its front matter). Then `explain-change status --json` says whether the explanation is valid.
 * Reported per scenario: the final state, the issues left, the agent's turns, cost and time (from
 * `claude -p --output-format json`), and its fidelity to the scenario's reference explanation (fidelity()).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { parseArgs } from "node:util";
import type { Explanation } from "../src/contract/explanation.ts";
import { removeTree } from "../src/core/fs.ts";
import { buildAssets } from "./build.ts";
import { buildScenarioRepo, GIT_ENV, SCENARIOS_DIR, scenarioNames } from "./build-examples.ts";

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
const prompt = readFileSync(join(ROOT, "skills/explain-change/SKILL.md"), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");

const readJson = (path: string): Explanation | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Explanation;
  } catch {
    return null;
  }
};

/** Share of the reference's items the agent also has (null when the reference has none). */
function recall(reference: string[], agent: string[]): number | null {
  const want = [...new Set(reference)];
  if (!want.length) return null;
  const have = new Set(agent);
  return want.filter((x) => have.has(x)).length / want.length;
}

/**
 * How close the agent's explanation is to the reference one, on what the facts let both see: the key dependencies,
 * the flow edges, the components the story lights and the files the decisions cite. Each is a recall in 0-1; the
 * mean is the score. It measures structure, not wording: a valid explanation that tells another story scores low.
 */
function fidelity(reference: Explanation | null, agent: Explanation | null): Record<string, number | null> {
  if (!reference || !agent) return { fidelity: null };
  const keyDeps = (e: Explanation) => (e.keyDependencies ?? []).map((k) => `${k.from}->${k.to}`);
  const edges = (e: Explanation) => (e.flows ?? []).flatMap((f) => f.steps.map((s) => `${s.from}->${s.to}`));
  const focus = (e: Explanation) =>
    e.story.filter((s) => (s.view ?? "architecture") === "architecture").flatMap((s) => s.focus ?? []);
  const evidence = (e: Explanation) => (e.decisions ?? []).map((d) => (d.evidence ?? "").split(":")[0] as string);
  const parts = {
    keyDeps: recall(keyDeps(reference), keyDeps(agent)),
    flowEdges: recall(edges(reference), edges(agent)),
    storyFocus: recall(focus(reference), focus(agent)),
    decisionFiles: recall(evidence(reference).filter(Boolean), evidence(agent)),
  };
  const known = Object.values(parts).filter((v): v is number => v !== null);
  const round = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
  return {
    fidelity: round(known.length ? known.reduce((a, b) => a + b, 0) / known.length : null),
    ...Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round(v)])),
  };
}

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
      ...fidelity(
        readJson(join(SCENARIOS_DIR, name, "explanation.json")),
        readJson(join(repo, ".explain-change", "explanation.json")),
      ),
    });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }
} finally {
  removeTree(tmp);
}
const valid = rows.filter((r) => r.state === "valid").length;
const scores = rows.map((r) => r.fidelity).filter((v): v is number => typeof v === "number");
const mean = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : "n/a";
console.log(`\n${valid}/${rows.length} valid with ${values.model}; mean fidelity to the references ${mean}`);
process.exitCode = valid === rows.length ? 0 : 1;
