import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { specRequirements } from "../analysis/openspec.ts";
import type { NormalizedExplanation } from "../contract/explanation.ts";
import type { Facts, FileFacts, Hunk } from "../contract/facts.ts";
import { LOCATION_RE } from "../contract/facts.ts";
import { FILES, VERSION } from "../core/constants.ts";
import { ensureDir } from "../core/fs.ts";
import { slugify } from "../core/text.ts";
import type { ExplanationStatus } from "../explanation/store.ts";
import { REPORT_CSS, REPORT_HTML, REPORT_JS } from "./assets.gen.ts";
import type { ReportData } from "./data.ts";

/** Context lines kept around each referenced range (the page shows at most 2). */
const EXCERPT_MARGIN = 3;

/** Line ranges the report shows as code: story steps, evidence, rule violations and requirements. */
export function excerptRanges(
  facts: Facts,
  explanation: NormalizedExplanation | null,
): Map<string, [number, number][]> {
  const refs: (string | undefined)[] = [
    ...facts.dependencies.filter((e) => e.violation).map((e) => e.examples[0]),
    ...specRequirements(facts).map((r) => `${r.file}:${r.line}`),
  ];
  if (explanation) {
    refs.push(...explanation.story.map((s) => s.code));
    refs.push(...explanation.decisions.map((d) => d.evidence));
    refs.push(...explanation.dataModel.entities.map((e) => e.evidence));
  }
  const out = new Map<string, [number, number][]>();
  for (const ref of refs) {
    const m = LOCATION_RE.exec(ref ?? "");
    if (!m) continue;
    const a = Number(m[2]);
    const list = out.get(m[1] as string) ?? [];
    list.push([a - EXCERPT_MARGIN, Number(m[3] ?? a) + EXCERPT_MARGIN]);
    out.set(m[1] as string, list);
  }
  return out;
}

/** Keeps only the hunk lines inside `ranges`, split into smaller hunks with exact start lines. */
export function pruneHunks(f: Pick<FileFacts, "delta" | "hunks">, ranges: [number, number][]): Hunk[] {
  const newSide = f.delta !== "removed";
  const out: Hunk[] = [];
  for (const h of f.hunks) {
    let o = h.oldStart;
    let n = h.newStart;
    let cur: Hunk | null = null;
    for (const [mark, body] of h.lines) {
      const line = newSide ? n : mark !== "+" ? o : n;
      if (ranges.some(([a, b]) => a <= line && line <= b)) {
        if (!cur) {
          cur = { oldStart: o, oldLines: 0, newStart: n, newLines: 0, header: h.header, lines: [] };
          out.push(cur);
        }
        cur.lines.push([mark, body]);
        if (mark !== "+") cur.oldLines++;
        if (mark !== "-") cur.newLines++;
      } else cur = null;
      if (mark !== "+") o++;
      if (mark !== "-") n++;
    }
  }
  return out;
}

/** The self-contained page: template, styles, script and data in one file that works offline. */
export function renderHtml(facts: Facts, status: ExplanationStatus): string {
  // The page shows excerpts, not the full diff (the PR has it): it ships only the lines it can show.
  const ranges = excerptRanges(facts, status.explanation);
  const shipped: Facts = {
    ...facts,
    files: facts.files.map((f) => ({ ...f, hunks: pruneHunks(f, ranges.get(f.path) ?? []) })),
  };
  const data: ReportData = {
    tool: VERSION,
    facts: shipped,
    explanation: status.explanation,
    state: status.state,
    issues: status.issues.slice(0, 20),
  };
  // Every "<" as \u003c: valid JSON that can never close the script tag or open an HTML comment inside it.
  const payload = JSON.stringify(data).replace(/</g, "\\u003c");
  const title = `${facts.config.name} · ${facts.source.title}`;
  return REPORT_HTML.replace("{{TITLE}}", escapeHtml(title))
    .replace("{{LANG}}", facts.config.lang)
    .replace("/*{{CSS}}*/", () => REPORT_CSS)
    .replace("/*{{JS}}*/", () => REPORT_JS.replace(/<\/script/gi, "<\\/script"))
    .replace("{{DATA}}", () => payload);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Where a change's report goes by default: one file per branch, so reports of other changes stay. */
export const defaultReportPath = (work: string, facts: Facts) =>
  join(work, FILES.reports, `${slugify(facts.source.branch || "change")}.html`);

/** Writes the page; returns its absolute path. */
export function writeReport(target: string, facts: Facts, status: ExplanationStatus): string {
  const path = resolve(target);
  ensureDir(dirname(path));
  writeFileSync(path, renderHtml(facts, status), "utf8");
  return path;
}
