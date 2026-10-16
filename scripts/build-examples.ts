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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Facts } from "../src/contract/facts.ts";
import { readReportData } from "../src/report/data.ts";
import { buildAssets } from "./build.ts";

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
  mkdirSync(repo, { recursive: true });
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

interface Row {
  file: string;
  project: string;
  branch: string;
  kind: "story" | "data-only";
  stack: string;
  shows: string;
  files: number;
  additions: number;
  deletions: number;
  components: number;
  violations: number;
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
  mkdirSync(repo, { recursive: true });
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

/** A gallery card from a rendered report: its numbers come from the data the page embeds. */
function rowOf(file: string, card: { project?: string; title?: string; stack: string; shows: string }): Row {
  const html = readFileSync(join(ROOT, "examples", file), "utf8");
  const data = readReportData(html);
  const facts = data.facts;
  return {
    file,
    project: card.project ?? facts.config.name,
    branch: card.title ?? facts.source.title,
    kind: data.explanation ? "story" : "data-only",
    stack: card.stack,
    shows: card.shows,
    files: facts.stats.files,
    additions: facts.stats.additions,
    deletions: facts.stats.deletions,
    components: facts.components.filter((c) => c.delta !== "unchanged").length,
    violations: facts.stats.newViolations,
  };
}

const GALLERY_CSS = `
:root {
  --bg: #f6f6f3; --surface: #ffffff; --border: #e3e3dd; --text: #1c1c1f; --muted: #6a6a70; --accent: #4b4fd6; --accent-bg: #ececfb;
  --added: #17803d; --violation: #d12a2a; --neutral-bg: #efeff0;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #111113; --surface: #19191c; --border: #2b2b30; --text: #ececef; --muted: #a0a0a8; --accent: #8b8ff5; --accent-bg: rgba(139,143,245,.14);
  --added: #4cc97a; --violation: #f26b6b; --neutral-bg: rgba(141,141,150,.14); color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #111113; --surface: #19191c; --border: #2b2b30; --text: #ececef; --muted: #a0a0a8; --accent: #8b8ff5; --accent-bg: rgba(139,143,245,.14);
  --added: #4cc97a; --violation: #f26b6b; --neutral-bg: rgba(141,141,150,.14); color-scheme: dark; }
body { background: var(--bg); color: var(--text); font: 15px/1.55 var(--font); margin: 0; }
.wrap { max-width: 860px; margin: 0 auto; padding-inline: 16px; padding-block: 40px 64px; }
h1 { font-size: 28px; margin: 0 0 8px; letter-spacing: -.01em; text-wrap: balance; }
.lead { color: var(--muted); margin: 0 0 28px; max-width: 62ch; }
.list { display: grid; gap: 12px; }
a.item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 16px; padding: 16px 18px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 12px; color: inherit; text-decoration: none; }
a.item:hover, a.item:focus-visible { border-color: var(--accent); outline: none; }
.top { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; min-width: 0; }
.name { font-weight: 650; }
.branch { font-family: var(--mono); font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
.stack { grid-column: 1 / -1; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.shows { grid-column: 1 / -1; margin: 0; max-width: 70ch; }
.stats { grid-column: 1 / -1; display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
.add { color: var(--added); } .del { color: var(--violation); }
.badge { align-self: start; padding: 2px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
.story { background: var(--accent-bg); color: var(--accent); } .data-only { background: var(--neutral-bg); color: var(--muted); }
h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 28px 0 12px; }
.foot { margin-top: 28px; font-size: 13px; color: var(--muted); }
code { font-family: var(--mono); font-size: .9em; }
`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function gallery(real: Row[], rows: Row[]): string {
  const label = { story: "With story", "data-only": "No story" };
  const cards = (list: Row[]) =>
    list
      .map(
        (r) =>
          `<a class="item" href="${esc(r.file)}"><div class="top"><span class="name">${esc(r.project)}</span>` +
          `<span class="branch">${esc(r.branch)}</span></div><span class="badge ${r.kind}">${label[r.kind]}</span>` +
          `<div class="stack">${esc(r.stack)}</div><p class="shows">${esc(r.shows)}</p>` +
          `<div class="stats"><span>${r.files} files</span><span><span class="add">+${r.additions}</span> ` +
          `<span class="del">−${r.deletions}</span></span><span>${r.components} components</span>` +
          (r.violations ? `<span>${r.violations} broken rules</span>` : "") +
          "</div></a>",
      )
      .join("");
  const items =
    (real.length ? `<h2>Real projects</h2><div class="list">${cards(real)}</div>` : "") +
    `<h2>Synthetic scenarios</h2><div class="list">${cards(rows)}</div>`;
  return (
    `<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>explain-change examples</title>\n<style>${GALLERY_CSS}</style>\n<main class="wrap">` +
    '<h1>explain-change examples</h1><p class="lead">Real open-source pull requests and synthetic changes, rendered by the same template. ' +
    "Each report is a single offline HTML file: an animated map (architecture lanes, data flows and, for spec-driven " +
    "changes, OpenSpec requirements traced to code) driven by a step-by-step story, then the design decisions " +
    "behind the change.</p>" +
    items +
    '<p class="foot">Generated by <code>scripts/build-examples.ts</code>.</p></main>\n'
  );
}

if (import.meta.main) {
  await buildAssets(); // the CLI runs from source: its embedded report must match report/
  const tmp = mkdtempSync(join(tmpdir(), "explain-change-examples-"));
  const rows: Row[] = [];
  try {
    for (const name of scenarioNames()) {
      const meta = JSON.parse(readFileSync(join(SCENARIOS_DIR, name, "scenario.json"), "utf8")) as ScenarioMeta;
      buildScenario(name, tmp, join(ROOT, "examples", `${name}.html`));
      rows.push(rowOf(`${name}.html`, { stack: meta.title, shows: meta.shows }));
      console.log(`${name}.html: ${rows[rows.length - 1]?.kind}`);
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
      rowOf(meta.report, { ...meta, shows: `${meta.shows} Config and explanation in examples/real/${name}.` }),
    );
  writeFileSync(join(ROOT, "examples/index.html"), gallery(real, rows));
}
