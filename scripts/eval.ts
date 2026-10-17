/**
 * Evaluates the skill end to end: a real agent explains each example, and the result is measured. Costs tokens.
 *
 *   bun scripts/eval.ts [--model haiku|sonnet|opus] [--agent "claude -p"] [--runs N] [--judge MODEL] [--discover]
 *                       [--out results.json] [--baseline results.json] [example…]
 *   bun scripts/eval.ts --rejudge results.json --judge MODEL [--out …] [--baseline …]   judge saved runs again
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
 * `inferred` the share the agent labelled as its own reading. In a 2nd call it checks each statement (tldr, goal,
 * story bodies, component summaries) against the digest: `faithful` is the share the digest shows, so prose that
 * names what the change does not contain scores less. A judge whose answer cannot be read is counted, not hidden.
 * --out writes every run (with the explanation the agent wrote) and the summary as JSON; --baseline reads such a file and compares the measures with it
 * (scripts/eval-metrics.ts compareRuns): a mean that drops by more than the noise (2 standard errors of the
 * difference, at least 0.1) fails the eval.
 * Use --runs 3 or more for a comparison: with 1 run there is no noise to measure. --rejudge judges the explanations
 * an --out file kept, with no agent: a change to the judge is measured on the same explanations.
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
import { argv, compareRuns, fidelity, lift, readTranscript, round, spread } from "./eval-metrics.ts";

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
    baseline: { type: "string" },
    rejudge: { type: "string" },
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

/**
 * The lines a location points at, at the head of the change: the clone of a real PR stays on its base, so the
 * working tree holds the old lines.
 */
function excerpt(repo: string, location: string): string {
  const m = /^(.+):(\d+)(?:-(\d+))?$/.exec(location);
  const head = readJson<Facts>(join(repo, ".explain-change", "facts.json"))?.source.headSha;
  if (!m || !head) return "";
  const show = spawnSync("git", ["show", `${head}:${m[1]}`], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (show.status !== 0) return "";
  const lines = show.stdout.split("\n");
  const a = Number(m[2]);
  const b = Math.min(Number(m[3] ?? m[2]), a + 40);
  return lines.slice(Math.max(a - 3, 0), b + 2).join("\n");
}

/** At most this many characters of each source the judge reads: the PR description, the OpenSpec documents. */
const SOURCE_CHARS = 12_000;

/**
 * The sources a decision's basis names, in full: the digest quotes the PR description cut short and lists the
 * OpenSpec design decisions by title only, so a judge that read only the digest could not see their why. The
 * OpenSpec proposal and design are read at the head of the change (at the base for a change the diff deletes).
 */
function sourcesOf(repo: string): { pr: string; spec: string } {
  const facts = readJson<Facts>(join(repo, ".explain-change", "facts.json"));
  if (!facts) return { pr: "", spec: "" };
  const show = (ref: string, path: string) =>
    spawnSync("git", ["show", `${ref}:${path}`], { cwd: repo, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).stdout ??
    "";
  const spec = (facts.openspec?.changes ?? [])
    .flatMap((c) =>
      c.artifacts
        .filter((a) => a.kind === "proposal" || a.kind === "design")
        .map((a) => `## ${a.path}\n${show(c.deleted ? facts.source.mergeBase : facts.source.headSha, a.path)}`),
    )
    .join("\n\n");
  return { pr: facts.source.description.slice(0, SOURCE_CHARS), spec: spec.slice(0, SOURCE_CHARS) };
}

/** The statements of an explanation the judge checks against the digest: tldr, goal, story bodies, summaries. */
function statements(ex: Explanation): string[] {
  return [
    ex.tldr,
    ex.goal,
    ...(ex.story ?? []).map((s) => s.body),
    ...(ex.components ?? []).map((c) => c.summary),
  ].filter((t): t is string => typeof t === "string" && t.trim() !== "" && !t.includes("<"));
}

/** Asks the judge 1 question; its answer as a verdict per item, or null when it cannot be read or has another count. */
function askJudge(ask: string, model: string, count: number): { supported: boolean }[] | null {
  const run = spawnSync(agentCmd, [...agentArgs, ask, "--model", model, "--output-format", "json"], {
    encoding: "utf8",
    timeout: 5 * 60_000,
  });
  try {
    const text = String(JSON.parse(run.stdout).result ?? "");
    const verdicts = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as { supported: boolean }[];
    return verdicts.length === count ? verdicts : null;
  } catch {
    return null;
  }
}

const share = (verdicts: { supported: boolean }[]) =>
  round(verdicts.filter((v) => v.supported).length / verdicts.length);

/**
 * 2 calls to the judge per run, each with 1 question, so neither measure changes the other's prompt. Decisions with
 * a basis other than inferred: does the source it names state the why (the PR description, the OpenSpec section of
 * the OpenSpec proposal and design, the code at the evidence), each given in full (sourcesOf)? Since 0.9.2, so
 * `grounded` does not compare with earlier versions, which gave the judge only the digest.
 * Statements (tldr, goal, story, component summaries): does the digest (its facts and hunks) show them? `grounded`
 * and `faithful` are the shares it confirms. `judgeError` is true when an answer cannot be read: that measure is
 * null for the run, and the summary counts it.
 */
function judge(
  repo: string,
  ex: Explanation | null,
  model: string,
): { grounded: number | null; inferred: number | null; faithful: number | null; judgeError: boolean } {
  const decisions = ex?.decisions ?? [];
  const inferred = decisions.length
    ? round(decisions.filter((d) => d.basis === "inferred").length / decisions.length)
    : null;
  const claims = decisions.filter((d) => d.basis !== "inferred");
  const said = ex ? statements(ex) : [];
  if (!claims.length && !said.length) return { grounded: null, inferred, faithful: null, judgeError: false };
  const digest = readFileSync(join(repo, ".explain-change", "digest.md"), "utf8");
  let judgeError = false;
  let grounded: number | null = null;
  if (claims.length) {
    const items = claims.map((d, i) => ({
      i,
      basis: d.basis,
      title: d.title,
      why: d.why,
      source: d.basis === "code" && d.evidence ? excerpt(repo, d.evidence) : null,
    }));
    const sources = sourcesOf(repo);
    const ask =
      "You check claims, nothing else. For each decision below, say whether its source states or directly shows " +
      "its why. Sources: basis pr = the PR description in <pr>; spec = the OpenSpec proposal and design in <spec>; " +
      "code = the excerpt given with it. A why the source does not support is false, even when it is plausible. " +
      'Answer only with JSON: [{"i": 0, "supported": true}, …].\n\n<pr>\n' +
      sources.pr +
      "\n</pr>\n\n<spec>\n" +
      sources.spec +
      "\n</spec>\n\n<decisions>\n" +
      JSON.stringify(items, null, 1) +
      "\n</decisions>";
    const verdicts = askJudge(ask, model, claims.length);
    if (verdicts) grounded = share(verdicts);
    else judgeError = true;
  }
  let faithful: number | null = null;
  if (said.length) {
    const ask =
      "You check claims, nothing else. For each statement below, say whether the digest (its facts and hunks) shows " +
      "it. A statement that names something the digest does not contain, or says it behaves otherwise, is false, " +
      'even when it is plausible. Answer only with JSON: [{"i": 0, "supported": true}, …].\n\n<digest>\n' +
      digest +
      "\n</digest>\n\n<statements>\n" +
      JSON.stringify(
        said.map((text, i) => ({ i, text })),
        null,
        1,
      ) +
      "\n</statements>";
    const verdicts = askJudge(ask, model, said.length);
    if (verdicts) faithful = share(verdicts);
    else judgeError = true;
  }
  return { grounded, inferred, faithful, judgeError };
}

if (values.rejudge && !values.judge) throw new Error("--rejudge needs --judge MODEL");
/**
 * --rejudge: the runs of an earlier --out file judged again, with no agent. Each example's repository is built and
 * collected once (`explain-change pr <url>` or `local`, as the agent ran it), then the judge reads each run's saved
 * explanation. Every other measure is the earlier run's.
 */
function rejudge(file: string, model: string): Record<string, unknown>[] {
  const before = JSON.parse(readFileSync(file, "utf8")) as { rows: Record<string, unknown>[] };
  const all = exampleTargets();
  const repos = new Map<string, string>();
  return before.rows.map((row) => {
    const target = all.find((t) => t.name === row.example);
    const written = (row.explanation ?? null) as Explanation | null;
    if (!target || !written) return row;
    let repo = repos.get(target.name);
    if (!repo) {
      repo = target.build(join(tmp, `rejudge-${target.name}`));
      spawnSync("bun", [join(ROOT, "src/cli/bin.ts"), ...target.args, "--no-open", "--json"], {
        cwd: repo,
        env,
        encoding: "utf8",
      });
      repos.set(target.name, repo);
    }
    const judged: Record<string, unknown> = { ...row, ...judge(repo, written, model) };
    const { explanation: _, ...line } = judged;
    console.log(JSON.stringify(line));
    return judged;
  });
}

const runs = Math.max(1, Number(values.runs) || 1);
const rows: Record<string, unknown>[] = [];
try {
  const targets = exampleTargets().filter((t) =>
    positionals.length ? positionals.includes(t.name) : t.kind === "real",
  );
  if (values.rejudge) rows.push(...rejudge(values.rejudge as string, values.judge as string));
  else
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
          explanation: written,
        });
        const { explanation: _, ...line } = rows[rows.length - 1] as Record<string, unknown>;
        console.log(JSON.stringify(line));
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
  ...(values.judge
    ? { grounded: stat("grounded"), faithful: stat("faithful"), inferred: stat("inferred"), judgeErrors }
    : {}),
};

if (runs > 1) {
  console.log("\nper example (mean ± sd over runs):");
  for (const name of [...new Set(rows.map((r) => r.example as string))]) {
    const own = rows.filter((r) => r.example === name);
    const valids = own.filter((r) => r.state === "valid").length;
    const grounded = values.judge ? `, grounded ${stat("grounded", own)}, faithful ${stat("faithful", own)}` : "";
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
      ? `; grounded ${summary.grounded}, faithful ${summary.faithful}, inferred ${summary.inferred} (judge ${values.judge}` +
        `${judgeErrors ? `, ${judgeErrors}/${judged.length} answers unreadable` : ""})`
      : ""),
);
if (values.out) {
  const options = {
    model: values.model,
    runs,
    discover: values.discover,
    judge: values.judge ?? null,
    rejudge: values.rejudge ?? null,
  };
  writeFileSync(values.out, `${JSON.stringify({ options, summary, rows }, null, 2)}\n`);
}
let regressed = false;
if (values.baseline) {
  const before = JSON.parse(readFileSync(values.baseline as string, "utf8")) as { rows: Record<string, unknown>[] };
  console.log(`\nagainst ${values.baseline}:`);
  for (const c of compareRuns(before.rows, rows)) {
    regressed ||= c.regressed;
    console.log(
      `  ${c.measure}: ${c.before} → ${c.now} (${c.delta >= 0 ? "+" : ""}${c.delta})${c.regressed ? "  REGRESSED" : ""}`,
    );
  }
}
process.exitCode = valid === rows.length && !regressed ? 0 : 1;
