/**
 * Builds the example reports in examples/*.html from the scenarios in examples/scenarios/<name>/: a git repository
 * per scenario (base/ committed on main, head/ on a branch), explained by the CLI and, when the scenario has one,
 * rendered with its explanation.json. Dates and identities are fixed, so the output is byte-identical every time.
 *
 *   bun scripts/build-examples.ts            rebuild the synthetic reports and the gallery
 *   bun scripts/build-examples.ts --real     also rebuild the reports of real PRs (needs the network and `gh`)
 *
 * A real example lives in examples/real/<name>/: real.json (repository, PR, its head and merge base, gallery card),
 * the team's explain-change.toml and the agent's explanation.json. It is explained the way a user does it: a clone
 * of the repository, then `explain-change pr <url>`, which reads the PR from GitHub (title, description, refs).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Facts } from "../src/contract/facts.ts";
import { ensureDir, removeTree } from "../src/core/fs.ts";
import { buildAssets } from "./build.ts";
import { type Example, galleryHtml, readExample, SOURCE } from "./gallery.ts";

const ROOT = join(import.meta.dir, "..");
export const SCENARIOS_DIR = join(ROOT, "examples/scenarios");
const CLI = join(ROOT, "src/cli/bin.ts");

/** A deterministic git: fixed identity and dates, no user or system config. */
export const GIT_ENV: Record<string, string> = {
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "dev",
  GIT_AUTHOR_EMAIL: "dev@example.com",
  GIT_COMMITTER_NAME: "dev",
  GIT_COMMITTER_EMAIL: "dev@example.com",
  GIT_AUTHOR_DATE: "2026-10-01T10:00:00+00:00",
  GIT_COMMITTER_DATE: "2026-10-01T10:00:00+00:00",
  EXPLAIN_CHANGE_NO_OPEN: "1",
};

export interface ScenarioMeta {
  title: string;
  shows: string;
  branch: string;
  message: string;
  dir?: string;
  /** false: a test fixture only, built by the tests but not published in the gallery. */
  publish?: boolean;
}

function sh(args: string[], cwd: string): string {
  const p = spawnSync(args[0] as string, args.slice(1), { cwd, env: { ...process.env, ...GIT_ENV }, encoding: "utf8" });
  if (p.status !== 0) throw new Error(`${args.join(" ")} failed in ${cwd}\n${p.stdout}\n${p.stderr}`);
  return p.stdout;
}

export const scenarioNames = () =>
  readdirSync(SCENARIOS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

/** The scenario's git repository under `tmp`: base/ (and its config) on main, head/ on the scenario's branch. */
export function buildScenarioRepo(name: string, tmp: string): string {
  const src = join(SCENARIOS_DIR, name);
  const meta = JSON.parse(readFileSync(join(src, "scenario.json"), "utf8")) as ScenarioMeta;
  const repo = join(tmp, name, meta.dir ?? "repo");
  ensureDir(repo);
  sh(["git", "init", "-q", "-b", "main"], repo);
  cpSync(join(src, "base"), repo, { recursive: true });
  if (existsSync(join(src, "explain-change.toml")))
    cpSync(join(src, "explain-change.toml"), join(repo, ".explain-change.toml"));
  sh(["git", "add", "-A"], repo);
  sh(["git", "commit", "-qm", "base"], repo);
  sh(["git", "checkout", "-qb", meta.branch], repo);
  cpSync(join(src, "head"), repo, { recursive: true });
  sh(["git", "add", "-A"], repo);
  sh(["git", "commit", "-qm", meta.message], repo);
  return repo;
}

/** Explains the scenario with the CLI and renders it to `out`; returns its facts. */
export function buildScenario(name: string, tmp: string, out: string): Facts {
  const repo = buildScenarioRepo(name, tmp);
  sh(["bun", CLI, "local", "--base", "main", "--no-open", "--out", out, "--json"], repo);
  const facts = JSON.parse(readFileSync(join(repo, ".explain-change/facts.json"), "utf8")) as Facts;
  const explanation = join(SCENARIOS_DIR, name, "explanation.json");
  if (existsSync(explanation)) {
    const body = JSON.parse(readFileSync(explanation, "utf8"));
    const full = { version: facts.version, key: facts.key, lang: facts.config.lang, ...body };
    writeFileSync(join(repo, ".explain-change/explanation.json"), `${JSON.stringify(full, null, 2)}\n`);
    const p = spawnSync("bun", [CLI, "render", "--no-open", "--out", out, "--json"], {
      cwd: repo,
      env: { ...process.env, ...GIT_ENV },
      encoding: "utf8",
    });
    if (p.status !== 0) throw new Error(`${name}: explanation rejected\n${p.stdout}${p.stderr}`);
  }
  return facts;
}

export const REAL_DIR = join(ROOT, "examples/real");

export interface RealMeta {
  repository: string;
  /** The PR number on GitHub. */
  pr: number;
  /** The PR's last commit and its merge base with the target: a build stops when GitHub says otherwise. */
  head: string;
  base: string;
  report: string;
  project: string;
  title: string;
  stack: string;
  shows: string;
}

export const realExamples = () =>
  readdirSync(REAL_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(REAL_DIR, d.name, "real.json")))
    .map((d) => ({
      name: d.name,
      meta: JSON.parse(readFileSync(join(REAL_DIR, d.name, "real.json"), "utf8")) as RealMeta,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));

/** owner/name of a GitHub repository URL. */
const slugOf = (repository: string) => repository.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");

export const prUrl = (meta: RealMeta) => `https://github.com/${slugOf(meta.repository)}/pull/${meta.pr}`;

const ghApi = (path: string, jq: string) => sh(["gh", "api", path, "--jq", jq], ROOT).trim();

/**
 * A clone of the PR's repository as a user has it, cut to what the PR needs: the recent history of its target and
 * of the PR, deep enough to hold their merge base, without blobs except at the checkout. `explain-change pr` then
 * fetches the PR itself. The merge base is checked out, so the analysis finds the blobs of both sides there.
 */
export function buildRealRepo(name: string, meta: RealMeta, tmp: string): string {
  const repo = join(tmp, name);
  ensureDir(repo);
  const target = ghApi(`repos/${slugOf(meta.repository)}/pulls/${meta.pr}`, ".base.ref");
  const refs = [
    `+refs/heads/${target}:refs/remotes/origin/${target}`,
    `+refs/pull/${meta.pr}/head:refs/remotes/origin/pr`,
  ];
  sh(["git", "init", "-q"], repo);
  sh(["git", "remote", "add", "origin", meta.repository], repo);
  sh(["git", "config", "remote.origin.promisor", "true"], repo);
  sh(["git", "config", "remote.origin.partialclonefilter", "blob:none"], repo);
  const mergeBase = () =>
    spawnSync("git", ["merge-base", `origin/${target}`, "origin/pr"], { cwd: repo, encoding: "utf8" }).stdout.trim();
  sh(["git", "fetch", "-q", "--filter=blob:none", "--depth=200", "origin", ...refs], repo);
  for (let i = 0; i < 10 && mergeBase() !== meta.base; i++) {
    sh(["git", "fetch", "-q", "--filter=blob:none", "--deepen=500", "origin", ...refs], repo);
  }
  if (mergeBase() !== meta.base) throw new Error(`${name}: the merge base of PR ${meta.pr} is not ${meta.base}`);
  sh(["git", "-c", "advice.detachedHead=false", "checkout", "-q", meta.head], repo);
  sh(["git", "-c", "advice.detachedHead=false", "checkout", "-q", meta.base], repo);
  cpSync(join(REAL_DIR, name, "explain-change.toml"), join(repo, ".explain-change.toml"));
  return repo;
}

/** `explain-change pr <url>` in a clone of the PR's repository, then its explanation rendered. */
function buildReal(name: string, meta: RealMeta, tmp: string): void {
  const repo = buildRealRepo(name, meta, tmp);
  const out = join(ROOT, "examples", meta.report);
  sh(["bun", CLI, "pr", prUrl(meta), "--no-open", "--out", out, "--json"], repo);
  const facts = JSON.parse(readFileSync(join(repo, ".explain-change/facts.json"), "utf8")) as Facts;
  if (facts.source.headSha !== meta.head || facts.source.mergeBase !== meta.base) {
    throw new Error(
      `${name}: GitHub now gives PR ${meta.pr} as ${facts.source.mergeBase}..${facts.source.headSha}, ` +
        `not ${meta.base}..${meta.head}: update real.json and its explanation`,
    );
  }
  const body = JSON.parse(readFileSync(join(REAL_DIR, name, "explanation.json"), "utf8"));
  writeFileSync(
    join(repo, ".explain-change/explanation.json"),
    JSON.stringify({ version: facts.version, key: facts.key, lang: facts.config.lang, ...body }),
  );
  const p = spawnSync("bun", [CLI, "render", "--no-open", "--out", out, "--json"], {
    cwd: repo,
    env: { ...process.env, ...GIT_ENV },
    encoding: "utf8",
  });
  if (p.status !== 0) throw new Error(`${name}: explanation rejected\n${p.stdout}${p.stderr}`);
}

/** Every example an agent explains: the scenarios (a branch against main) and the real PRs (by their URL). */
export interface ExampleTarget {
  name: string;
  kind: "scenario" | "real";
  /** What the user asks the agent, in the user's words. */
  request: string;
  /** The CLI command that request leads to. */
  args: string[];
  /** The committed explanation (absent for a scenario without an agent). */
  explanation: string;
  /** Builds its repository under `tmp`; returns its path. */
  build: (tmp: string) => string;
}

export function exampleTargets(): ExampleTarget[] {
  return [
    ...scenarioNames().map((name) => ({
      name,
      kind: "scenario" as const,
      request: "Explain my changes on this branch with explain-change.",
      args: ["local", "--base", "main"],
      explanation: join(SCENARIOS_DIR, name, "explanation.json"),
      build: (tmp: string) => buildScenarioRepo(name, tmp),
    })),
    ...realExamples().map(({ name, meta }) => ({
      name,
      kind: "real" as const,
      request: `Explain ${prUrl(meta)} with explain-change.`,
      args: ["pr", prUrl(meta)],
      explanation: join(REAL_DIR, name, "explanation.json"),
      build: (tmp: string) => buildRealRepo(name, meta, tmp),
    })),
  ];
}

if (import.meta.main) {
  await buildAssets(); // the CLI runs from source: its embedded report must match report/
  const tmp = mkdtempSync(join(tmpdir(), "explain-change-examples-"));
  const scenarios: Example[] = [];
  try {
    for (const name of scenarioNames()) {
      const meta = JSON.parse(readFileSync(join(SCENARIOS_DIR, name, "scenario.json"), "utf8")) as ScenarioMeta;
      if (meta.publish === false) continue;
      buildScenario(name, tmp, join(ROOT, "examples", `${name}.html`));
      const example = readExample(join(ROOT, "examples"), `${name}.html`, { stack: meta.title, shows: meta.shows }, [
        ["Scenario source", `${SOURCE}/scenarios/${name}`],
      ]);
      scenarios.push(example);
      console.log(`${name}.html: ${example.explained ? "story" : "data-only"}`);
    }
    if (process.argv.includes("--real")) {
      for (const { name, meta } of realExamples()) {
        buildReal(name, meta, tmp);
        console.log(`${meta.report}: rebuilt from ${meta.repository}`);
      }
    }
  } finally {
    removeTree(tmp);
  }
  const real = realExamples()
    .filter(({ meta }) => existsSync(join(ROOT, "examples", meta.report)))
    .map(({ name, meta }) =>
      readExample(join(ROOT, "examples"), meta.report, meta, [
        ["Upstream PR", prUrl(meta)],
        ["Config and explanation", `${SOURCE}/real/${name}`],
      ]),
    );
  writeFileSync(join(ROOT, "examples/index.html"), galleryHtml(real, scenarios));
}
