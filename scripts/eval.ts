/**
 * Evaluates the skill end to end: a real agent explains each example, and the result is measured. Costs tokens.
 *
 *   bun scripts/eval.ts [--model haiku|sonnet|opus] [--agent "claude -p"] [--runs N] [--judge MODEL] [example…]
 *
 * The examples are the real PRs (examples/real/<name>), each asked for by its GitHub URL, as a user does (needs
 * the network and `gh`). A test fixture (examples/scenarios/<name>, asked as "explain my changes") runs only by
 * name. For each one: its git repository is built in a temp folder, `explain-change` (this checkout) is put on
 * PATH, and the agent gets the user's request plus skills/explain-change/SKILL.md (the skill itself, without its
 * front matter). Then `explain-change status --json` says whether the explanation is valid.
 * Reported per example: the final state, the issues left, the agent's turns, cost and time (from
 * `claude -p --output-format json`), and its fidelity to the example's committed explanation (fidelity()). The
 * references are the committed explanations: rewrite them with the current tool (scripts/example-work.ts) first.
 *
 * --runs N explains each example N times and reports the mean and the standard deviation: 1 run of an agent is a
 * sample, not a score. --judge MODEL asks a second agent, per decision, whether the source its basis names (the PR
 * description, the spec, the code at the evidence) states its why; `grounded` is the share it confirms, and
 * `inferred` the share the agent labelled as its own reading.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { parseArgs } from "node:util";
import type { Explanation } from "../src/contract/explanation.ts";
import { removeTree } from "../src/core/fs.ts";
import { buildAssets } from "./build.ts";
import { exampleTargets, GIT_ENV } from "./build-examples.ts";

const ROOT = join(import.meta.dir, "..");
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    model: { type: "string", default: "sonnet" },
    agent: { type: "string", default: "claude -p" },
    runs: { type: "string", default: "1" },
    judge: { type: "string" },
  },
  allowPositionals: true,
});
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

/**
 * F1 of the agent's items against the reference's: recall (the reference's items the agent has) and precision (the
 * agent's items the reference has) together, so naming everything does not score. null when both are empty.
 */
function f1(reference: string[], agent: string[]): number | null {
  const want = new Set(reference);
  const have = new Set(agent);
  if (!want.size && !have.size) return null;
  const hit = [...have].filter((x) => want.has(x)).length;
  return hit ? (2 * hit) / (want.size + have.size) : 0;
}

/**
 * How close the agent's explanation is to the reference one, on what the facts let both see: the key dependencies,
 * the flow edges, the components the story lights and the files the decisions cite. Each is an F1 in 0-1; the
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
    keyDeps: f1(keyDeps(reference), keyDeps(agent)),
    flowEdges: f1(edges(reference), edges(agent)),
    storyFocus: f1(focus(reference), focus(agent)),
    decisionFiles: f1(evidence(reference).filter(Boolean), evidence(agent).filter(Boolean)),
  };
  const known = Object.values(parts).filter((v): v is number => v !== null);
  const round = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
  return {
    fidelity: round(known.length ? known.reduce((a, b) => a + b, 0) / known.length : null),
    ...Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round(v)])),
  };
}

/** The lines a location points at, from the repository the agent worked in. */
function excerpt(repo: string, location: string): string {
  const m = /^(.+):(\d+)(?:-(\d+))?$/.exec(location);
  if (!m) return "";
  try {
    const lines = readFileSync(join(repo, m[1] as string), "utf8").split("\n");
    const a = Number(m[2]);
    const b = Math.min(Number(m[3] ?? m[2]), a + 40);
    return lines.slice(Math.max(a - 3, 0), b + 2).join("\n");
  } catch {
    return "";
  }
}

/**
 * Asks the judge, for each decision with a basis other than inferred, whether its source states the why. The
 * source is the PR description (pr), the OpenSpec section of the digest (spec) or the code at the evidence (code).
 */
function judge(
  repo: string,
  ex: Explanation | null,
  model: string,
): { grounded: number | null; inferred: number | null } {
  const decisions = ex?.decisions ?? [];
  if (!decisions.length) return { grounded: null, inferred: null };
  const inferred = decisions.filter((d) => d.basis === "inferred").length / decisions.length;
  const claims = decisions.filter((d) => d.basis !== "inferred");
  if (!claims.length) return { grounded: null, inferred };
  const digest = readFileSync(join(repo, ".explain-change", "digest.md"), "utf8");
  const items = claims.map((d, i) => ({
    i,
    basis: d.basis,
    title: d.title,
    why: d.why,
    source: d.basis === "code" && d.evidence ? excerpt(repo, d.evidence) : null,
  }));
  const ask =
    "You check claims, nothing else. For each decision below, say whether its source states or directly shows " +
    "its why. Sources: basis pr = the PR description in the digest; spec = the OpenSpec part of the digest; code = " +
    "the excerpt given with it. A why the source does not support is false, even when it is plausible. Answer " +
    'only with JSON: [{"i": 0, "supported": true}, …].\n\n<digest>\n' +
    digest +
    "\n</digest>\n\n<decisions>\n" +
    JSON.stringify(items, null, 1) +
    "\n</decisions>";
  const [cmd, ...args] = (values.agent as string).split(" ");
  const run = spawnSync(cmd as string, [...args, ask, "--model", model, "--output-format", "json"], {
    encoding: "utf8",
    timeout: 5 * 60_000,
  });
  try {
    const text = String(JSON.parse(run.stdout).result ?? "");
    const verdicts = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as { supported: boolean }[];
    return { grounded: verdicts.filter((v) => v.supported).length / claims.length, inferred };
  } catch {
    return { grounded: null, inferred };
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
/** "mean ± sd" of the numbers in `xs`, or null when there are none. */
function spread(xs: unknown[]): string | null {
  const n = xs.filter((x): x is number => typeof x === "number");
  if (!n.length) return null;
  const mean = n.reduce((a, b) => a + b, 0) / n.length;
  const sd = Math.sqrt(n.reduce((a, b) => a + (b - mean) ** 2, 0) / n.length);
  return n.length > 1 ? `${round(mean)} ± ${round(sd)}` : String(round(mean));
}

const runs = Math.max(1, Number(values.runs) || 1);
const rows: Record<string, unknown>[] = [];
try {
  const targets = exampleTargets().filter((t) =>
    positionals.length ? positionals.includes(t.name) : t.kind === "real",
  );
  for (const target of targets) {
    for (let r = 1; r <= runs; r++) {
      const name = target.name;
      const runDir = join(tmp, `run-${r}`);
      mkdirSync(runDir, { recursive: true });
      const repo = target.build(runDir);
      const [cmd, ...args] = (values.agent as string).split(" ");
      const started = Date.now();
      const run = spawnSync(
        cmd as string,
        [
          ...args,
          target.request,
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
      const written = readJson(join(repo, ".explain-change", "explanation.json"));
      rows.push({
        example: name,
        run: r,
        state: out.explanation?.state ?? "error",
        issues: out.explanation?.issues?.length ?? null,
        turns: agent.num_turns ?? null,
        costUsd: agent.total_cost_usd ?? null,
        seconds: Math.round((Date.now() - started) / 1000),
        ...fidelity(readJson(target.explanation), written),
        ...(values.judge ? judge(repo, written, values.judge) : {}),
      });
      console.log(JSON.stringify(rows[rows.length - 1]));
    }
  }
} finally {
  removeTree(tmp);
}

const valid = rows.filter((r) => r.state === "valid").length;
const column = (k: string, of = rows) => of.map((r) => r[k]);
if (runs > 1) {
  console.log("\nper example (mean ± sd over runs):");
  for (const name of [...new Set(rows.map((r) => r.example as string))]) {
    const own = rows.filter((r) => r.example === name);
    const valids = own.filter((r) => r.state === "valid").length;
    const judged = values.judge ? `, grounded ${spread(column("grounded", own)) ?? "n/a"}` : "";
    console.log(
      `  ${name}: ${valids}/${own.length} valid, fidelity ${spread(column("fidelity", own)) ?? "n/a"}, ` +
        `turns ${spread(column("turns", own)) ?? "n/a"}, cost ${spread(column("costUsd", own)) ?? "n/a"}${judged}`,
    );
  }
}
const cost = column("costUsd").filter((v): v is number => typeof v === "number");
console.log(
  `\n${valid}/${rows.length} valid with ${values.model} (${runs} run${runs > 1 ? "s" : ""} per example); ` +
    `fidelity (F1) ${spread(column("fidelity")) ?? "n/a"}; cost $${round(cost.reduce((a, b) => a + b, 0))}` +
    (values.judge
      ? `; grounded ${spread(column("grounded")) ?? "n/a"}, inferred ${spread(column("inferred")) ?? "n/a"} (judge ${values.judge})`
      : ""),
);
process.exitCode = valid === rows.length ? 0 : 1;
