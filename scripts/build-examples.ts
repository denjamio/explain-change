/**
 * Builds the example reports in examples/*.html from the scenarios in examples/scenarios/<name>/: a git repository
 * per scenario (base/ committed on main, head/ on a branch), explained by the CLI and, when the scenario has one,
 * rendered with its explanation.json. Dates and identities are fixed, so the output is byte-identical every time.
 *
 *   bun scripts/build-examples.ts            rebuild the synthetic reports and the gallery
 *   bun scripts/build-examples.ts --real     also rebuild the reports of real PRs (clones them: needs the network)
 *
 * A real example lives in examples/real/<name>/: real.json (repository, commit, gallery card), the team's
 * explain-change.toml and the agent's explanation.json.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Facts } from "../src/contract/facts.ts";
import { ensureDir } from "../src/core/fs.ts";
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

const REAL_DIR = join(ROOT, "examples/real");

interface RealMeta {
  repository: string;
  commit: string;
  report: string;
  project: string;
  title: string;
  stack: string;
  shows: string;
}

const realExamples = () =>
  readdirSync(REAL_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(REAL_DIR, d.name, "real.json")))
    .map((d) => ({
      name: d.name,
      meta: JSON.parse(readFileSync(join(REAL_DIR, d.name, "real.json"), "utf8")) as RealMeta,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));

/** Clones the PR's commit and its parent, then explains it with the team's config and the agent's explanation. */
function buildReal(name: string, meta: RealMeta, tmp: string): void {
  const repo = join(tmp, name);
  ensureDir(repo);
  sh(["git", "init", "-q"], repo);
  sh(["git", "remote", "add", "origin", meta.repository], repo);
  sh(["git", "fetch", "-q", "--depth", "2", "origin", meta.commit], repo);
  sh(["git", "checkout", "-q", "FETCH_HEAD"], repo);
  cpSync(join(REAL_DIR, name, "explain-change.toml"), join(repo, ".explain-change.toml"));
  const out = join(ROOT, "examples", meta.report);
  sh(["bun", CLI, "local", "--base", "HEAD~1", "--no-open", "--out", out, "--json"], repo);
  const facts = JSON.parse(readFileSync(join(repo, ".explain-change/facts.json"), "utf8")) as Facts;
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

if (import.meta.main) {
  await buildAssets(); // the CLI runs from source: its embedded report must match report/
  const tmp = mkdtempSync(join(tmpdir(), "explain-change-examples-"));
  const scenarios: Example[] = [];
  try {
    for (const name of scenarioNames()) {
      const meta = JSON.parse(readFileSync(join(SCENARIOS_DIR, name, "scenario.json"), "utf8")) as ScenarioMeta;
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
    rmSync(tmp, { recursive: true, force: true });
  }
  const real = realExamples()
    .filter(({ meta }) => existsSync(join(ROOT, "examples", meta.report)))
    .map(({ name, meta }) =>
      readExample(join(ROOT, "examples"), meta.report, meta, [
        ["Upstream commit", `${meta.repository.replace(/\.git$/, "")}/commit/${meta.commit}`],
        ["Config and explanation", `${SOURCE}/real/${name}`],
      ]),
    );
  writeFileSync(join(ROOT, "examples/index.html"), galleryHtml(real, scenarios));
}
