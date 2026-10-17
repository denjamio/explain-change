/**
 * Evaluates the skill end to end: a real agent explains each example, and the result is measured. Costs tokens.
 *
 *   bun scripts/eval.ts [--model haiku|sonnet|opus] [--agent "claude -p"] [--runs N] [--judge MODEL] [--discover]
 *                       [--out results.json] [example…]
 *
 * The examples are the real PRs (examples/real/<name>), each asked for by its GitHub URL, as a user does (needs
 * the network and `gh`). A test fixture (examples/scenarios/<name>, asked as "explain my changes") runs only by
 * name. For each one: its git repository is built in a temp folder, `explain-change` (this checkout) is put on
 * PATH, and the agent gets the user's request plus skills/explain-change/SKILL.md (the skill itself, without its
 * front matter). With --discover the skills are installed in the repository's .claude/skills instead, and nothing
 * names them: the agent must load explain-change from its description, as in a user's session (`skill` reports
 * whether it did). Then `explain-change status --json` says whether the explanation is valid.
 *
 * Reported per run (scripts/eval-metrics.ts):
 * - state and issues left; turns, cost, time, prompt and output tokens, `explain-change render` calls (1 = valid
 *   at the first try) and source files read outside the work folder, from the agent's transcript;
 * - fidelity: the F1 of key dependencies, flow edges, the components the story lights and the files the decisions
 *   cite, against the example's committed explanation (rewrite them with scripts/example-work.ts first);
 * - draft: the same F1 for the draft the CLI wrote, which already holds the outline's focus, key dependency and
 *   flows, so it is what an agent that changes nothing scores; lift: what the agent adds to it (fidelity − draft,
 *   over the parts both measure);
 * - digest: the size of the digest the agent read, in characters.
 *
 * --runs N explains each example N times and reports the mean and the standard deviation: 1 run of an agent is a
 * sample, not a score. --judge MODEL asks a second agent, per decision, whether the source its basis names (the PR
 * description, the spec, the code at the evidence) states its why; `grounded` is the share it confirms, and
 * `inferred` the share the agent labelled as its own reading. A judge whose answer cannot be read is counted, not
 * hidden. --out writes every run and the summary as JSON, to compare a version with the last one.
 */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { parseArgs } from "node:util";
import type { Explanation } from "../src/contract/explanation.ts";
import type { Facts } from "../src/contract/facts.ts";
import { removeTree } from "../src/core/fs.ts";
import { draftExplanation } from "../src/explanation/draft.ts";
import { buildAssets } from "./build.ts";
import { exampleTargets, GIT_ENV } from "./build-examples.ts";
import { argv, fidelity, lift, readTranscript, round, spread } from "./eval-metrics.ts";

const ROOT = join(import.meta.dir, "..");
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    model: { type: "string", default: "haiku" },
    agent: { type: "string", default: "claude -p" },
    runs: { type: "string", default: "1" },
    judge: { type: "string" },
    discover: { type: "boolean", default: false },
    out: { type: "string" },
  },
  allowPositionals: true,
});
const [agentCmd, ...agentArgs] = argv(values.agent as string) as [string, ...string[]];
await buildAssets();
const tmp = mkdtempSync(join(tmpdir(), "explain-change-eval-"));
const bin = join(tmp, "bin");
mkdirSync(bin);
const shim = join(bin, "explain-change");
writeFileSync(shim, `#!/bin/sh\nexec bun "${join(ROOT, "src/cli/bin.ts")}" "$@"\n`);
chmodSync(shim, 0o755);
const env = { ...process.env, ...GIT_ENV, PATH: `${bin}${delimiter}${process.env.PATH}` };
const prompt = readFileSync(join(ROOT, "skills/explain-change/SKILL.md"), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");

const readJson = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
};

/** The skills as a user's project has them: in .claude/skills, kept out of git status. */
function installSkills(repo: string): void {
  for (const skill of ["explain-change", "explain-change-configure"]) {
    cpSync(join(ROOT, "skills", skill), join(repo, ".claude", "skills", skill), { recursive: true });
  }
  appendFileSync(join(repo, ".git", "info", "exclude"), "\n.claude/\n");
}

/** The draft the CLI wrote for the facts the agent got, or null when the agent never collected the change. */
function draftOf(repo: string): Explanation | null {
  const facts = readJson<Facts>(join(repo, ".explain-change", "facts.json"));
  return facts ? (draftExplanation(facts) as unknown as Explanation) : null;
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
 * `judgeError` is true when its answer cannot be read: that run has no `grounded`, and the summary counts it.
 */
function judge(
  repo: string,
  ex: Explanation | null,
  model: string,
): { grounded: number | null; inferred: number | null; judgeError: boolean } {
  const decisions = ex?.decisions ?? [];
  if (!decisions.length) return { grounded: null, inferred: null, judgeError: false };
  const inferred = round(decisions.filter((d) => d.basis === "inferred").length / decisions.length);
  const claims = decisions.filter((d) => d.basis !== "inferred");
  if (!claims.length) return { grounded: null, inferred, judgeError: false };
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
  const run = spawnSync(agentCmd, [...agentArgs, ask, "--model", model, "--output-format", "json"], {
    encoding: "utf8",
    timeout: 5 * 60_000,
  });
  try {
    const text = String(JSON.parse(run.stdout).result ?? "");
    const verdicts = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as { supported: boolean }[];
    if (verdicts.length !== claims.length) throw new Error("a verdict per claim");
    return { grounded: round(verdicts.filter((v) => v.supported).length / claims.length), inferred, judgeError: false };
  } catch {
    return { grounded: null, inferred, judgeError: true };
  }
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
      if (values.discover) installSkills(repo);
      const started = Date.now();
      const run = spawnSync(
        agentCmd,
        [
          ...agentArgs,
          target.request,
          "--model",
          values.model as string,
          "--output-format",
          "stream-json",
          "--verbose",
          ...(values.discover ? [] : ["--append-system-prompt", prompt]),
          "--allowedTools",
          "Bash(explain-change:*)",
          "Read",
          "Edit",
          "Write",
          ...(values.discover ? ["Skill"] : []),
        ],
        { cwd: repo, env, encoding: "utf8", timeout: 15 * 60_000, maxBuffer: 256 * 1024 * 1024 },
      );
      const { skills, ...transcript } = readTranscript(run.stdout ?? "");
      const status = spawnSync("bun", [join(ROOT, "src/cli/bin.ts"), "status", "--json"], {
        cwd: repo,
        env,
        encoding: "utf8",
      });
      const out = JSON.parse(status.stdout || "{}");
      const written = readJson<Explanation>(join(repo, ".explain-change", "explanation.json"));
      const reference = readJson<Explanation>(target.explanation);
      const agentFit = fidelity(reference, written);
      const draftFit = fidelity(reference, draftOf(repo));
      const digest = join(repo, ".explain-change", "digest.md");
      rows.push({
        example: name,
        run: r,
        state: out.explanation?.state ?? "error",
        issues: out.explanation?.issues?.length ?? null,
        ...(values.discover ? { skill: skills.includes("explain-change") } : {}),
        ...transcript,
        seconds: Math.round((Date.now() - started) / 1000),
        digest: existsSync(digest) ? readFileSync(digest, "utf8").length : null,
        ...agentFit,
        draft: draftFit.fidelity,
        lift: lift(agentFit, draftFit),
        ...(values.judge ? judge(repo, written, values.judge) : {}),
      });
      console.log(JSON.stringify(rows[rows.length - 1]));
    }
  }
} finally {
  removeTree(tmp);
}

const column = (k: string, of = rows) => of.map((r) => r[k]);
const stat = (k: string, of = rows) => spread(column(k, of)) ?? "n/a";
const valid = rows.filter((r) => r.state === "valid").length;
const judged = rows.filter((r) => "judgeError" in r);
const judgeErrors = judged.filter((r) => r.judgeError).length;
const cost = column("costUsd").filter((v): v is number => typeof v === "number");
const summary = {
  valid,
  runs: rows.length,
  fidelity: stat("fidelity"),
  draft: stat("draft"),
  lift: stat("lift"),
  renders: stat("renders"),
  sourceReads: stat("sourceReads"),
  tokensIn: stat("tokensIn"),
  tokensOut: stat("tokensOut"),
  digest: stat("digest"),
  costUsd: round(cost.reduce((a, b) => a + b, 0)),
  ...(values.discover ? { skillLoaded: rows.filter((r) => r.skill).length } : {}),
  ...(values.judge ? { grounded: stat("grounded"), inferred: stat("inferred"), judgeErrors } : {}),
};

if (runs > 1) {
  console.log("\nper example (mean ± sd over runs):");
  for (const name of [...new Set(rows.map((r) => r.example as string))]) {
    const own = rows.filter((r) => r.example === name);
    const valids = own.filter((r) => r.state === "valid").length;
    const grounded = values.judge ? `, grounded ${stat("grounded", own)}` : "";
    console.log(
      `  ${name}: ${valids}/${own.length} valid, fidelity ${stat("fidelity", own)} (draft ${stat("draft", own)}, ` +
        `lift ${stat("lift", own)}), renders ${stat("renders", own)}, turns ${stat("turns", own)}, ` +
        `cost ${stat("costUsd", own)}${grounded}`,
    );
  }
}
console.log(
  `\n${valid}/${rows.length} valid with ${values.model} (${runs} run${runs > 1 ? "s" : ""} per example` +
    `${values.discover ? `, skill loaded from its description in ${summary.skillLoaded}/${rows.length}` : ""}); ` +
    `fidelity (F1) ${summary.fidelity}, draft ${summary.draft}, lift ${summary.lift}; ` +
    `renders ${summary.renders}, source reads ${summary.sourceReads}; ` +
    `tokens in ${summary.tokensIn}, out ${summary.tokensOut}, digest ${summary.digest} chars; cost $${summary.costUsd}` +
    (values.judge
      ? `; grounded ${summary.grounded}, inferred ${summary.inferred} (judge ${values.judge}` +
        `${judgeErrors ? `, ${judgeErrors}/${judged.length} answers unreadable` : ""})`
      : ""),
);
if (values.out) {
  const options = { model: values.model, runs, discover: values.discover, judge: values.judge ?? null };
  writeFileSync(values.out, `${JSON.stringify({ options, summary, rows }, null, 2)}\n`);
}
process.exitCode = valid === rows.length ? 0 : 1;
