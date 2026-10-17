/**
 * Evaluates the skill end to end: a real agent explains each example, and graders check the result. Costs tokens;
 * `--max-cost` caps them. Designed after `claude plugin eval` and skill-creator (see scripts/eval-graders.ts).
 *
 *   bun scripts/eval.ts [--split train|test|all] [--runs N] [--model haiku] [--judge haiku|none] [--discover]
 *                       [--out results.json] [--baseline results.json] [--compare results.json] [--max-cost USD]
 *                       [example…]
 *   bun scripts/eval.ts --rejudge results.json [--judge …] [--out …] [--baseline …] [--compare …]
 *   bun scripts/eval.ts --calibrate [--split …] [--judge …] [--out …]
 *
 * The examples are the real PRs (examples/real/<name>), each asked for by its GitHub URL, as a user does (needs the
 * network and `gh`). real.json's `eval` puts a PR in the `train` split (the default) or the `test` split: an
 * improvement loop reads the failures of train only, and keeps a change when test does not drop, so it cannot fit
 * the PRs it is scored on. A test fixture (examples/scenarios/<name>) runs only by name. For each run: the example's
 * repository is built in a temp folder, `explain-change` (this checkout) is put on PATH, and the agent gets the
 * user's request plus skills/explain-change/SKILL.md, with no MCP server and no other skill. With --discover the
 * skills are installed in the repository's .claude/skills instead and nothing names them (`skill` reports whether
 * the agent loaded explain-change from its description).
 *
 * Each run is graded (scripts/eval-graders.ts): pass/fail graders in 4 groups, structure (deterministic, against the
 * facts), content (the example's assertions.json, written from the PR's diff, never from the tool), prose (a rubric)
 * and grounded (each decision's why against its source); `score` is the share that pass. The judge (--judge, haiku
 * by default; `none` keeps only the free graders) makes 2 short calls per run. The summary lists the failing graders
 * first: what to fix. Also reported, not scored: turns, cost, tokens, `render` calls, source files read, the digest's
 * size, and the F1 of the structure against the committed explanation (`fidelity`, `draft`, `lift`): a regression
 * check, not a measure of quality.
 *
 * --runs N repeats each example: 1 run of an agent is a sample. --out keeps every run (with its explanation and
 * verdicts) and the summary as JSON. --baseline compares with such a file: a mean that drops by more than the noise
 * fails the eval, and the graders an iteration fixed or broke are listed. --compare asks the judge, per example,
 * which of the 2 explanations (the file's and this eval's, run by run) serves a reviewer better, blind and in both
 * orders. --rejudge grades the explanations an --out file kept, with no agent: a change to the graders is measured
 * on the same explanations. --calibrate is the meta-eval: it grades each example's committed explanation and its
 * mutants (scripts/eval-mutants.ts) and reports which graders catch which known defect.
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
import { delimiter, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import type { Explanation } from "../src/contract/explanation.ts";
import type { Facts } from "../src/contract/facts.ts";
import { removeTree } from "../src/core/fs.ts";
import { draftExplanation } from "../src/explanation/draft.ts";
import { buildAssets } from "./build.ts";
import { type ExampleTarget, exampleTargets, GIT_ENV } from "./build-examples.ts";
import {
  type Assertion,
  type AssertionFile,
  GROUPS,
  graderChanges,
  graderStats,
  mentionGraders,
  RUBRIC,
  scores,
  signTest,
  structureGraders,
  type Verdict,
} from "./eval-graders.ts";
import { grounded, pairwise, review, spent } from "./eval-judge.ts";
import { argv, compareRuns, fidelity, lift, readTranscript, round, spread } from "./eval-metrics.ts";
import { caught, mutants } from "./eval-mutants.ts";

const ROOT = join(import.meta.dir, "..");
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    model: { type: "string", default: "haiku" },
    agent: { type: "string", default: "claude -p" },
    runs: { type: "string", default: "1" },
    split: { type: "string", default: "train" },
    judge: { type: "string", default: "haiku" },
    discover: { type: "boolean", default: false },
    out: { type: "string" },
    baseline: { type: "string" },
    compare: { type: "string" },
    rejudge: { type: "string" },
    calibrate: { type: "boolean", default: false },
    "max-cost": { type: "string" },
  },
  allowPositionals: true,
});
const agentCommand = values.agent as string;
const [agentCmd, ...agentArgs] = argv(agentCommand) as [string, ...string[]];
const judgeModel = values.judge === "none" ? null : (values.judge as string);
const maxCost = values["max-cost"] ? Number(values["max-cost"]) : Number.POSITIVE_INFINITY;
if (!["train", "test", "all"].includes(values.split as string)) throw new Error("--split is train, test or all");
if ((values.calibrate || values.compare) && !judgeModel) throw new Error("--calibrate and --compare need a judge");

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

type Row = Record<string, unknown> & { example: string; graders?: Verdict[]; explanation?: Explanation | null };

/** The skills as a user's project has them: in .claude/skills, kept out of git status. */
function installSkills(repo: string): void {
  for (const skill of ["explain-change", "explain-change-configure"]) {
    cpSync(join(ROOT, "skills", skill), join(repo, ".claude", "skills", skill), { recursive: true });
  }
  appendFileSync(join(repo, ".git", "info", "exclude"), "\n.claude/\n");
}

const assertionsOf = (target: ExampleTarget): Assertion[] =>
  readJson<AssertionFile>(join(dirname(target.explanation), "assertions.json"))?.assertions ?? [];

const factsOf = (repo: string) => readJson<Facts>(join(repo, ".explain-change", "facts.json"));

/** The example's repository with the change collected, as `explain-change pr <url>` (or `local`) leaves it. */
function collected(target: ExampleTarget, dir: string): { repo: string; facts: Facts } {
  const repo = target.build(dir);
  spawnSync("bun", [join(ROOT, "src/cli/bin.ts"), ...target.args, "--no-open", "--json"], {
    cwd: repo,
    env,
    encoding: "utf8",
  });
  const facts = factsOf(repo);
  if (!facts) throw new Error(`${target.name}: the CLI wrote no facts`);
  return { repo, facts };
}

/** Every grader on 1 explanation: the free ones, then the judge's 2 calls. No explanation fails them all. */
function grade(repo: string, facts: Facts, ex: Explanation | null, valid: boolean, assertions: Assertion[]): Verdict[] {
  const free = [...structureGraders(facts, ex, valid), ...mentionGraders(ex, assertions)];
  if (!judgeModel) return free;
  if (!ex) {
    const ids = [...assertions.filter((a) => a.kind === "llm").map((a) => a.id), ...RUBRIC.map((r) => r.id)];
    return [
      ...free,
      ...ids.map((id) => ({ id, group: "content" as const, passed: false, evidence: "no explanation" })),
    ];
  }
  return [
    ...free,
    ...review(agentCommand, judgeModel, facts, ex, assertions),
    ...grounded(agentCommand, judgeModel, repo, facts, ex),
  ];
}

const agentCost = (rows: Row[]) =>
  rows.map((r) => r.costUsd).reduce<number>((a, c) => a + (typeof c === "number" ? c : 0), 0);

/** The examples of the split, or the named ones. */
const targets = exampleTargets().filter((t) =>
  positionals.length
    ? positionals.includes(t.name)
    : t.kind === "real" && (values.split === "all" || t.split === values.split),
);
const runs = Math.max(1, Number(values.runs) || 1);
const rows: Row[] = [];
let partial = false;

/** 1 agent run: the agent explains the example, then every grader checks what it wrote. */
function agentRun(target: ExampleTarget, r: number): Row {
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
      "--strict-mcp-config",
      ...(values.discover ? [] : ["--append-system-prompt", prompt, "--disable-slash-commands"]),
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
  const state = (JSON.parse(status.stdout || "{}").explanation ?? {}) as { state?: string; issues?: unknown[] };
  const written = readJson<Explanation>(join(repo, ".explain-change", "explanation.json"));
  const facts = factsOf(repo);
  const reference = readJson<Explanation>(target.explanation);
  const agentFit = fidelity(reference, written);
  const draftFit = fidelity(reference, facts ? (draftExplanation(facts) as unknown as Explanation) : null);
  const digest = join(repo, ".explain-change", "digest.md");
  const graders = facts ? grade(repo, facts, written, state.state === "valid", assertionsOf(target)) : [];
  return {
    example: target.name,
    split: target.split,
    run: r,
    state: state.state ?? "error",
    issues: state.issues?.length ?? null,
    ...(values.discover ? { skill: skills.includes("explain-change") } : {}),
    ...transcript,
    seconds: Math.round((Date.now() - started) / 1000),
    digest: existsSync(digest) ? readFileSync(digest, "utf8").length : null,
    ...scores(graders),
    ...agentFit,
    draft: draftFit.fidelity,
    lift: lift(agentFit, draftFit),
    graders,
    explanation: written,
  };
}

/** The runs of an earlier --out file graded again, with no agent: each example collected once. */
function rejudge(file: string): Row[] {
  const before = JSON.parse(readFileSync(file, "utf8")) as { rows: Row[] };
  const all = exampleTargets();
  const cache = new Map<string, { repo: string; facts: Facts }>();
  return before.rows.map((row) => {
    const target = all.find((t) => t.name === row.example);
    if (!target) return row;
    let c = cache.get(target.name);
    if (!c) {
      c = collected(target, join(tmp, "rejudge"));
      cache.set(target.name, c);
    }
    const ex = row.explanation ?? null;
    const graders = grade(c.repo, c.facts, ex, row.state === "valid", assertionsOf(target));
    return { ...row, split: target.split, ...scores(graders), graders };
  });
}

const log = (row: Row) => {
  const { explanation: _, graders, ...line } = row;
  const failed = (graders ?? []).filter((v) => v.passed === false).map((v) => v.id);
  console.log(JSON.stringify({ ...line, failed }));
};

/** The meta-eval: every grader on each committed explanation and its mutants; which defects each grader catches. */
function calibrate(): void {
  const found: Record<string, unknown>[] = [];
  const clean: Row[] = [];
  for (const target of targets) {
    const good = readJson<Explanation>(target.explanation);
    if (!good) continue;
    const assertions = assertionsOf(target);
    const { repo, facts } = collected(target, join(tmp, "calibrate"));
    const free = (ex: Explanation) => [...structureGraders(facts, ex, true), ...mentionGraders(ex, assertions)];
    const reviewed = review(agentCommand, judgeModel as string, facts, good, assertions);
    const groundedGood = grounded(agentCommand, judgeModel as string, repo, facts, good);
    const goodVerdicts = [...free(good), ...reviewed, ...groundedGood];
    clean.push({ example: target.name, graders: goodVerdicts });
    for (const m of mutants(facts, good)) {
      const bad = [
        ...free(m.explanation),
        ...(m.review ? review(agentCommand, judgeModel as string, facts, m.explanation, assertions) : reviewed),
        ...(m.grounded ? grounded(agentCommand, judgeModel as string, repo, facts, m.explanation) : groundedGood),
      ];
      const hit = caught(m.targets, goodVerdicts, bad);
      found.push({ example: target.name, kind: m.kind, caught: hit });
      console.log(JSON.stringify({ example: target.name, kind: m.kind, caught: hit }));
    }
    console.log(JSON.stringify({ example: target.name, ...scores(goodVerdicts), cost: round(spent()) }));
  }
  console.log("\nmutants caught (caught/measurable; a mutant is not measurable where its graders fail the good one):");
  const kinds = [...new Set(found.map((f) => f.kind as string))];
  let hits = 0;
  let measurable = 0;
  for (const kind of kinds) {
    const own = found.filter((f) => f.kind === kind && f.caught !== null);
    const n = own.filter((f) => f.caught).length;
    hits += n;
    measurable += own.length;
    const missed = own.filter((f) => !f.caught).map((f) => f.example);
    console.log(`  ${kind}: ${n}/${own.length}${missed.length ? `  missed in ${missed.join(", ")}` : ""}`);
  }
  const good = scores(clean.flatMap((r) => r.graders ?? []));
  console.log(
    `\ndetection ${measurable ? round(hits / measurable) : "n/a"} (${hits}/${measurable}); the committed ` +
      `explanations score ${good.score} (${GROUPS.map((g) => `${g} ${good[g]}`).join(", ")}); judge $${round(spent())}`,
  );
  console.log("graders the committed explanations fail (a good explanation should pass them):");
  for (const s of graderStats(clean).filter((s) => s.failed))
    console.log(`  ${s.example}  ${s.group}  ${s.id}: ${s.sample}`);
  if (values.out) writeFileSync(values.out, `${JSON.stringify({ mutants: found, clean }, null, 2)}\n`);
}

try {
  if (values.calibrate) calibrate();
  else if (values.rejudge) {
    rows.push(...rejudge(values.rejudge));
    rows.forEach(log);
  } else
    for (const target of targets) {
      for (let r = 1; r <= runs; r++) {
        if (agentCost(rows) + spent() >= maxCost) {
          partial = true;
          break;
        }
        const row = agentRun(target, r);
        rows.push(row);
        log(row);
      }
    }
  if (!values.calibrate) report();
} finally {
  removeTree(tmp);
}

function report(): void {
  const column = (k: string, of = rows) => of.map((r) => r[k]);
  const stat = (k: string, of = rows) => spread(column(k, of)) ?? "n/a";
  const valid = rows.filter((r) => r.state === "valid").length;
  const groups = (of: Row[]) => GROUPS.map((g) => `${g} ${stat(g, of)}`).join(", ");
  const splits = [...new Set(rows.map((r) => r.split as string))].sort();

  console.log("\nper example (mean ± sd over runs):");
  for (const name of [...new Set(rows.map((r) => r.example))]) {
    const own = rows.filter((r) => r.example === name);
    console.log(
      `  ${name} [${own[0]?.split}]: ${own.filter((r) => r.state === "valid").length}/${own.length} valid, ` +
        `score ${stat("score", own)} (${groups(own)}); renders ${stat("renders", own)}, turns ${stat("turns", own)}`,
    );
  }
  const failing = graderStats(rows)
    .filter((s) => s.failed)
    .sort((a, b) => b.failed / (b.failed + b.passed) - a.failed / (a.failed + a.passed) || (a.id < b.id ? -1 : 1));
  console.log("\nfailing graders, most often first (runs failed/graded): what to fix");
  for (const s of failing.filter((s) => s.example && rows.find((r) => r.example === s.example)?.split !== "test"))
    console.log(`  ${s.example}  ${s.group}  ${s.id}  ${s.failed}/${s.failed + s.passed}: ${s.sample}`);
  const hidden = failing.filter((s) => rows.find((r) => r.example === s.example)?.split === "test").length;
  if (hidden) console.log(`  (+${hidden} on the test split, kept out of sight: score it, do not fit it)`);

  const cost = round(agentCost(rows) + spent());
  console.log(
    `\n${valid}/${rows.length} valid with ${values.model} (${runs} run${runs > 1 ? "s" : ""} per example` +
      `${values.discover ? `, skill loaded from its description in ${rows.filter((r) => r.skill).length}/${rows.length}` : ""}` +
      `${partial ? ", stopped at --max-cost" : ""}); score ${stat("score")} (${groups(rows)})` +
      `${
        splits.length > 1
          ? `; ${splits
              .map(
                (s) =>
                  `${s} ${stat(
                    "score",
                    rows.filter((r) => r.split === s),
                  )}`,
              )
              .join(", ")}`
          : ""
      }` +
      `; fidelity (F1) ${stat("fidelity")}, lift ${stat("lift")}; renders ${stat("renders")}, ` +
      `source reads ${stat("sourceReads")}; tokens in ${stat("tokensIn")}, out ${stat("tokensOut")}; ` +
      `cost $${cost} (judge ${judgeModel ?? "none"} $${round(spent())})`,
  );

  let regressed = false;
  if (values.baseline) {
    const before = JSON.parse(readFileSync(values.baseline, "utf8")) as { rows: Row[] };
    console.log(`\nagainst ${values.baseline}:`);
    for (const c of compareRuns(before.rows, rows)) {
      regressed ||= c.regressed;
      console.log(
        `  ${c.measure}: ${c.before} → ${c.now} (${c.delta >= 0 ? "+" : ""}${c.delta})${c.regressed ? "  REGRESSED" : ""}`,
      );
    }
    const { fixed, broke } = graderChanges(graderStats(before.rows), graderStats(rows));
    for (const [label, list] of [
      ["fixed", fixed],
      ["broke", broke],
    ] as const) {
      if (list.length)
        console.log(`  ${label}: ${list.map((c) => `${c.example} ${c.id} ${c.before}→${c.now}`).join("; ")}`);
    }
  }
  if (values.compare) {
    const before = JSON.parse(readFileSync(values.compare, "utf8")) as { rows: Row[] };
    const tally = { now: 0, before: 0, tie: 0, unread: 0 };
    for (const row of rows) {
      const old = before.rows.find((b) => b.example === row.example && b.run === row.run);
      const target =
        targets.find((t) => t.name === row.example) ?? exampleTargets().find((t) => t.name === row.example);
      if (!old?.explanation || !row.explanation || !target) continue;
      const won = pairwise(
        agentCommand,
        judgeModel as string,
        target.request,
        assertionsOf(target),
        old.explanation,
        row.explanation,
      );
      tally[won ?? "unread"]++;
      console.log(JSON.stringify({ example: row.example, run: row.run, better: won }));
    }
    console.log(
      `\nblind A/B against ${values.compare}: this eval better in ${tally.now}, the earlier one in ${tally.before}, ` +
        `tie ${tally.tie}${tally.unread ? `, unread ${tally.unread}` : ""}; sign test p = ${signTest(tally.now, tally.before)}`,
    );
  }
  if (values.out) {
    const options = { model: values.model, runs, split: values.split, discover: values.discover, judge: judgeModel };
    const summary = {
      valid,
      runs: rows.length,
      partial,
      ...Object.fromEntries(["score", ...GROUPS, "fidelity", "lift", "renders", "tokensIn"].map((k) => [k, stat(k)])),
      costUsd: cost,
      judgeUsd: round(spent()),
    };
    writeFileSync(values.out, `${JSON.stringify({ options, summary, rows }, null, 2)}\n`);
  }
  process.exitCode = valid === rows.length && !regressed && !partial ? 0 : 1;
}
