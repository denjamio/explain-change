/**
 * The examples gallery, examples/index.html (published at https://denjamio.github.io/explain-change/). Every number
 * and feature on it is read from the data each report embeds, so the gallery cannot drift from the reports.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPOSITORY, VERSION } from "../src/core/constants.ts";
import { readReportData } from "../src/report/data.ts";
import { bulbDataUri } from "./build.ts";

export const SOURCE = `https://github.com/${REPOSITORY}/tree/main/examples`;
const REPO_URL = `https://github.com/${REPOSITORY}`;

/** What a report shows, as the gallery's cards and matrix list it. */
interface Features {
  configured: boolean;
  story: number | null; // steps the agent wrote; null: the automatic story
  flows: number;
  entities: number;
  decisions: number;
  rules: number;
  violations: number;
  glossary: number;
  requirements: number | null; // OpenSpec requirements; null: not a spec-driven change
}

export interface Example {
  file: string;
  project: string;
  title: string;
  stack: string;
  shows: string;
  explained: boolean;
  files: number;
  additions: number;
  deletions: number;
  components: number;
  features: Features;
  /** What the report was built from: [label, URL]. */
  links: [string, string][];
}

/** A gallery entry from a rendered report in `dir`. */
export function readExample(
  dir: string,
  file: string,
  card: { project?: string; title?: string; stack: string; shows: string },
  links: Example["links"],
): Example {
  const { facts, explanation: x } = readReportData(readFileSync(join(dir, file), "utf8"));
  const { config, stats } = facts;
  return {
    file,
    project: card.project ?? config.name,
    title: card.title ?? facts.source.title,
    stack: card.stack,
    shows: card.shows,
    explained: Boolean(x),
    files: stats.files,
    additions: stats.additions,
    deletions: stats.deletions,
    components: facts.components.filter((c) => c.delta !== "unchanged").length,
    features: {
      configured: !config.inferred,
      story: x ? x.story.length : null,
      flows: x?.flows.length ?? 0,
      entities: x?.dataModel.entities.length ?? 0,
      decisions: x?.decisions.length ?? 0,
      rules: config.rules.allow.length + config.rules.forbid.length,
      violations: stats.newViolations,
      glossary: config.glossary.length,
      requirements: facts.openspec ? facts.openspec.changes.reduce((n, c) => n + c.requirements.length, 0) : null,
    },
    links,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The features a card lists, as short chips. */
function chips(f: Features): string[] {
  return [
    f.story === null ? "Automatic story" : `${f.story}-step story`,
    f.flows ? plural(f.flows, "data flow") : "",
    f.entities ? "Data model" : "",
    f.decisions ? plural(f.decisions, "decision") : "",
    f.requirements !== null ? "OpenSpec" : "",
    f.glossary ? "Glossary" : "",
    f.configured ? "" : "No config",
    f.violations ? plural(f.violations, "broken rule") : "",
  ].filter(Boolean);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function card(e: Example): string {
  return (
    `<article class="card">
<div class="eyebrow">${esc(e.stack)}</div>
<h3><a class="open" href="${esc(e.file)}">${esc(e.project)}</a></h3>
<p class="change">${esc(e.title)}</p>
<p class="shows">${esc(e.shows)}</p>
<ul class="chips">${chips(e.features)
      .map((c) => `<li>${esc(c)}</li>`)
      .join("")}</ul>
<div class="foot-row"><span class="stats">${plural(e.files, "file")} · <span class="add">+${e.additions}</span> ` +
    `<span class="del">−${e.deletions}</span> · ${plural(e.components, "component")}</span>` +
    `<span class="cta" aria-hidden="true">Open report →</span></div>
<div class="links">${e.links.map(([label, url]) => `<a href="${esc(url)}">${esc(label)} ↗</a>`).join("")}</div>
</article>`
  );
}

function matrix(all: Example[]): string {
  const dash = '<span class="none">—</span>';
  const num = (v: number | null) => (v ? String(v) : dash);
  const head = ["Example", "Config", "Story", "Flows", "Entities", "Decisions", "Rules", "Glossary", "OpenSpec"];
  const rows = all.map((e) => {
    const f = e.features;
    const rules = f.rules
      ? `${f.rules}${f.violations ? ` <span class="del">(${f.violations} broken)</span>` : ""}`
      : dash;
    return [
      `<a href="${esc(e.file)}">${esc(e.project)}</a><div class="sub">${esc(e.stack)}</div>`,
      f.configured ? "Configured" : "Inferred",
      f.story === null ? "Automatic" : String(f.story),
      num(f.flows),
      num(f.entities),
      num(f.decisions),
      rules,
      num(f.glossary),
      num(f.requirements),
    ];
  });
  return (
    `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${c}</td>` : `<th scope="row">${c}</th>`)).join("")}</tr>`).join("")}</tbody></table></div>`
  );
}

const READING = [
  [
    "The map",
    "Your layers as lanes and components as boxes. Green is added, blue changed, gray removed; a red arrow breaks one of your rules.",
  ],
  ["The story", "A few steps walk through the change. Each one moves the map to what changed and shows the code."],
  ["The why", "Design decisions with the alternative not taken, then each changed component and its files."],
];

const CSS = `
:root {
  --bg: #f6f6f3; --surface: #ffffff; --border: #e3e3dd; --text: #1c1c1f; --muted: #6a6a70; --accent: #4b4fd6;
  --accent-bg: #ececfb; --added: #17803d; --violation: #d12a2a; --chip: #f0f0ec;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #111113; --surface: #19191c; --border: #2b2b30; --text: #ececef; --muted: #a0a0a8; --accent: #8b8ff5;
  --accent-bg: rgba(139,143,245,.14); --added: #4cc97a; --violation: #f26b6b; --chip: #232327; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #111113; --surface: #19191c; --border: #2b2b30; --text: #ececef; --muted: #a0a0a8; --accent: #8b8ff5;
  --accent-bg: rgba(139,143,245,.14); --added: #4cc97a; --violation: #f26b6b; --chip: #232327; color-scheme: dark; }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--text); font: 15px/1.55 var(--font); margin: 0; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 48px 16px 72px; }
a { color: var(--accent); }
header { display: grid; gap: 14px; margin-bottom: 36px; }
.mark { width: 28px; height: 28px; display: block; } .mark svg { width: 100%; height: 100%; display: block; } .mark .bulb-line { stroke: var(--accent); }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; color: var(--accent); letter-spacing: .02em; }
h1 { font-size: 34px; line-height: 1.15; margin: 0; letter-spacing: -.015em; text-wrap: balance; }
.lead { color: var(--muted); margin: 0; max-width: 68ch; font-size: 16px; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; }
.btn { display: inline-block; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface);
  color: var(--text); text-decoration: none; font-weight: 600; font-size: 14px; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn:hover, .btn:focus-visible { border-color: var(--accent); }
.reading { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0 0 44px; padding: 0; list-style: none; }
.reading li { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; font-size: 14px; color: var(--muted); }
.reading b { display: block; color: var(--text); margin-bottom: 2px; }
section { margin-top: 40px; }
h2 { font-size: 20px; margin: 0 0 4px; }
.section-lead { color: var(--muted); margin: 0 0 16px; max-width: 72ch; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 16px; }
.card { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 18px 20px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 14px; transition: border-color .15s, box-shadow .15s; }
.card:hover, .card:focus-within { border-color: var(--accent); box-shadow: 0 4px 18px rgba(0,0,0,.06); }
.eyebrow { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
.card h3 { margin: 0; font-size: 18px; }
a.open { color: inherit; text-decoration: none; outline: none; }
a.open::after { content: ""; position: absolute; inset: 0; border-radius: 14px; }
.change { margin: -4px 0 0; font-family: var(--mono); font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
.shows { margin: 0; flex: 1; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 0; padding: 0; list-style: none; }
.chips li { font-size: 12.5px; padding: 2px 9px; border-radius: 999px; background: var(--chip); color: var(--text); }
.foot-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-top: 4px;
  padding-top: 10px; border-top: 1px solid var(--border); font-size: 13px; }
.stats { color: var(--muted); font-variant-numeric: tabular-nums; }
.cta { color: var(--accent); font-weight: 600; }
.add { color: var(--added); } .del { color: var(--violation); }
.links { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; }
.links a { position: relative; z-index: 1; text-decoration: none; }
.links a:hover, .links a:focus-visible { text-decoration: underline; }
.table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; font-variant-numeric: tabular-nums; }
th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; vertical-align: top; }
thead th { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 600; }
tbody tr:last-child > * { border-bottom: 0; }
tbody th { font-weight: 600; } tbody th a { color: var(--text); text-decoration: none; } tbody th a:hover { color: var(--accent); }
.sub { font-weight: 400; font-size: 12.5px; color: var(--muted); }
.none { color: var(--muted); }
td { text-align: right; } thead th:not(:first-child) { text-align: right; } td:nth-child(2) { text-align: left; } thead th:nth-child(2) { text-align: left; }
footer { margin-top: 48px; font-size: 13px; color: var(--muted); }
code { font-family: var(--mono); font-size: .9em; }
@media (max-width: 760px) { .reading { grid-template-columns: 1fr; } h1 { font-size: 28px; } }
`;

/** The gallery page: real pull requests first, then the spec-driven change, then what each example shows. */
export function galleryHtml(real: Example[], scenarios: Example[]): string {
  const section = (id: string, title: string, lead: string, list: Example[]) =>
    list.length
      ? `<section id="${id}"><h2>${title}</h2><p class="section-lead">${lead}</p><div class="grid">${list.map(card).join("")}</div></section>`
      : "";
  return (
    `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>explain-change examples</title>
<link rel="icon" href="${bulbDataUri()}">
<meta name="description" content="Architecture-first explanations of real pull requests from open-source products, generated by explain-change.">
<style>${CSS}</style>
<main class="wrap">
<header>
<div class="brand"><span class="mark" aria-hidden="true">${readFileSync(join(import.meta.dir, "../report/bulb.svg"), "utf8").trim()}</span>explain-change</div>
<h1>See what a code change does</h1>
<p class="lead">Its architecture, data flows and design decisions, in one page. Each example below is a real pull request of an open-source product, rendered as one offline HTML file. The CLI computes the facts; an agent writes the prose.</p>
<div class="actions"><a class="btn primary" href="${esc(real[0]?.file ?? scenarios[0]?.file ?? "#")}">Open an example</a>` +
    `<a class="btn" href="${REPO_URL}#quick-start">Install</a><a class="btn" href="${REPO_URL}">GitHub</a></div>
</header>
<ul class="reading">${READING.map(([t, d]) => `<li><b>${t}</b>${d}</li>`).join("")}</ul>
${section("real", "Real pull requests", "2 pull requests from each of 5 open-source products, in Rails, Django, TypeScript and .NET. Each product's config was written with the configure skill, each story by an agent.", real)}
${section("sdd", "Spec-driven development", "A change that carries its OpenSpec proposal, design, tasks and spec deltas, each requirement traced to the code and the tests that implement it.", scenarios)}
<section id="matrix"><h2>What each example shows</h2><p class="section-lead">Counted from the data each report embeds: story steps, data flows, data model entities, design decisions, dependency rules, glossary terms and OpenSpec requirements.</p>${matrix([...real, ...scenarios])}</section>
<footer>Built with <a href="${REPO_URL}">explain-change</a> ${VERSION} by <code>scripts/build-examples.ts</code>.</footer>
</main>
</html>
`
  );
}
