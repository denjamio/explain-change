/** The report's data (embedded in the page) and the lookups every section shares. */

import type { NormalizedExplanation } from "../src/contract/explanation.ts";
import type { ComponentFacts, Delta, DependencyFacts, FileFacts, Requirement } from "../src/contract/facts.ts";
import { prFileUrl as fileUrlOnPr, type LineRange, lineRange } from "../src/hosts/links.ts";
import type { ReportData } from "../src/report/data.ts";
import { cap } from "./dom.ts";
import { T, t } from "./words.ts";

export type NFlow = NormalizedExplanation["flows"][number];
export type NStep = NFlow["steps"][number];
export type StoryStep = NormalizedExplanation["story"][number];
export type Entity = NormalizedExplanation["dataModel"]["entities"][number];
export type ReqStatus = "implemented" | "partial" | "missing" | "not-applicable" | "pending" | "none";

export const DATA: ReportData = JSON.parse((document.getElementById("ec-data") as HTMLElement).textContent ?? "{}");
export const facts = DATA.facts;
export const ex = DATA.explanation;
export const cfg = facts.config;
export const src = facts.source;
export const st = facts.stats;
export const OS = facts.openspec;
export const REDUCED = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/** git's one-letter status of a changed file. */
export const gitLetter = (f: FileFacts) =>
  f.delta === "added" ? "A" : f.delta === "removed" ? "D" : f.previousPath ? "R" : "M";

export const compById: Record<string, (typeof cfg.components)[number]> = {};
export const layerRank: Record<string, number> = {};
export const compRank: Record<string, [number, number]> = {};
cfg.layers.forEach((l, i) => {
  layerRank[l.id] = i;
});
cfg.components.forEach((c, i) => {
  compById[c.id] = c;
  compRank[c.id] = [layerRank[c.layer] ?? 99, i];
});
export function byCompRank(a: string, b: string): number {
  const ra = compRank[a] ?? [99, 999];
  const rb = compRank[b] ?? [99, 999];
  return ra[0] - rb[0] || ra[1] - rb[1] || (a < b ? -1 : a > b ? 1 : 0);
}
export const changeComp: Record<string, ComponentFacts> = {};
for (const c of facts.components) changeComp[c.id] = c;
export const fileIndex: Record<string, number> = {};
facts.files.forEach((f, i) => {
  fileIndex[f.path] = i;
});
export const summaryOf: Record<string, string> = {};
if (ex) for (const c of ex.components) summaryOf[c.id] = c.summary;
export const compName = (id: string) => compById[id]?.name ?? id;
export function layerName(id: string): string {
  const c = compById[id];
  return c ? (cfg.layers[layerRank[c.layer] ?? -1]?.name ?? c.layer) : "";
}
/** The label of a delta: a component left untouched is a "neighbor"; anything else unchanged is "unchanged". */
export function deltaLabel(delta: Delta, component = false): string {
  if (delta === "unchanged") return component ? T.lNeighbor : T.lUnchanged;
  return t(`l${cap(delta)}`);
}

// OpenSpec: the requirements (deltas of the changes, then main-spec edits no delta covers) and the agent's map.
export const REQS: Requirement[] = [];
export const reqById: Record<string, Requirement> = {};
if (OS) {
  for (const c of OS.changes) REQS.push(...c.requirements);
  const seen = new Set(REQS.map((r) => r.id));
  for (const sp of OS.specs) for (const r of sp.requirements) if (!seen.has(r.id)) REQS.push(r);
  for (const r of REQS) reqById[r.id] = r;
}
export const specMap: Record<string, NormalizedExplanation["requirements"][number]> = {};
if (ex) for (const m of ex.requirements) specMap[m.id] = m;
export const reqsOfComp = (id: string) => REQS.filter((r) => specMap[r.id]?.components?.includes(id));
/** Requirement ids → the components that implement them; component ids pass through. */
export function specComponents(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const comps = reqById[id] ? (specMap[id]?.components ?? []) : compById[id] ? [id] : [];
    for (const c of comps) if (!out.includes(c)) out.push(c);
  }
  return out;
}
/** The agent's status; pending = not mapped yet; none = removed or renamed, nothing to map. */
export function reqStatus(r: Requirement): ReqStatus {
  const m = specMap[r.id];
  if (m) return m.status;
  return ex?.requirements.length || r.op === "REMOVED" || r.op === "RENAMED" ? "none" : "pending";
}
export const RS_ICON: Record<ReqStatus, string> = {
  implemented: "✓",
  partial: "◐",
  missing: "✗",
  "not-applicable": "–",
  pending: "…",
  none: "–",
};
export const rsLabel = (v: ReqStatus) => (v === "pending" ? T.notMapped : v === "none" ? "—" : t(v));

// A file reference links to the file in the PR when the source has one; otherwise it is plain text. With lines, it
// opens the PR at them when a hunk holds them, on the base side for a removed file or a removed symbol.
export function prFileUrl(path: string, lines?: { start: number; end?: number; old?: boolean }): string | null {
  if (src.kind !== "pr" || !src.url || !src.host) return null;
  const removed = facts.files[fileIndex[path] ?? -1]?.delta === "removed";
  const side: LineRange["side"] = removed || lines?.old ? "old" : "new";
  const spans = DATA.hunkSpans?.[path];
  const range = lines && spans ? lineRange(spans, side, lines.start, lines.end) : undefined;
  return fileUrlOnPr(src.host, src.url, path, range, side === "new" ? src.headSha : src.mergeBase);
}

export const DM = ex?.dataModel.entities.length ? ex.dataModel : null;
export const entById: Record<string, Entity> = {};
if (DM) for (const e of DM.entities) entById[e.id] = e;

export const isNewViolation = (e: DependencyFacts) => Boolean(e.violation && !e.violation.preexisting);
