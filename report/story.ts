/*
 * The views the map offers and the story that walks them: the agent's, or one told from the facts; and which untouched components the map draws.
 */

import type { ComponentFacts } from "../src/contract/facts.ts";
import { fmt } from "./dom.ts";
import {
  byCompRank,
  compById,
  compName,
  DM,
  ex,
  facts,
  isNewViolation,
  layerName,
  type NFlow,
  OS,
  REQS,
  type StoryStep,
  specMap,
  st,
} from "./model.ts";
import { T, tf } from "./words.ts";

// ═════════════════════════════ map + story ═════════════════════════════
/** The key dependencies of the explanation, "from>to" → label: the map highlights them. */
export const keyPairs: Record<string, string> = {};
if (ex) for (const x of ex.keyDependencies) keyPairs[`${x.from}>${x.to}`] = x.label ?? "";

export interface ViewTab {
  id: string;
  title: string;
  flow?: NFlow;
}
export const VIEWS: ViewTab[] = [{ id: "architecture", title: T.architecture }];
for (const fl of ex?.flows ?? []) VIEWS.push({ id: `flow:${fl.id}`, title: fl.title, flow: fl });
if (DM) VIEWS.push({ id: "data", title: T.dataView });
export const flowById: Record<string, NFlow> = {};
for (const fl of ex?.flows ?? []) flowById[fl.id] = fl;
/** The name of a view, as its tab shows it. */
export function viewTitle(view: string): string {
  if (view === "requirements") return T.reqs;
  return VIEWS.find((v) => v.id === view)?.title ?? T.architecture;
}

/** The story without an agent: the facts told in order, so the map still guides the reader. */
export function autoStory(): StoryStep[] {
  const steps: StoryStep[] = [];
  const touched = facts.components.filter((c) => c.delta !== "unchanged");
  const layers = new Set(touched.map((c) => compById[c.id]?.layer));
  steps.push({
    heading: tf("autoOverviewH", { n: touched.length, m: layers.size }),
    body: tf("autoOverviewB", { f: st.files, a: fmt(st.additions), d: fmt(st.deletions) }),
    view: "architecture",
    focus: [],
  });
  for (const e of facts.dependencies.filter((e) => e.violation && !e.violation.preexisting).slice(0, 2)) {
    steps.push({
      heading: tf("autoViolH", { a: compName(e.from), b: compName(e.to) }),
      body: e.violation?.rule ?? "",
      view: "architecture",
      focus: [e.from, e.to],
      code: e.examples[0],
    });
  }
  for (const c of touched.filter((c) => c.delta === "added").slice(0, 2)) {
    steps.push({
      heading: tf("autoNewH", { x: compName(c.id) }),
      body: tf("autoNewB", { l: layerName(c.id) }),
      view: "architecture",
      focus: [c.id],
    });
  }
  for (const c of touched.filter((c) => c.delta === "removed").slice(0, 1)) {
    steps.push({
      heading: tf("autoRemovedH", { x: compName(c.id) }),
      body: T.autoRemovedB,
      view: "architecture",
      focus: [c.id],
    });
  }
  touched
    .filter((c) => c.delta === "changed")
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions) || byCompRank(a.id, b.id))
    .slice(0, Math.max(0, 5 - steps.length))
    .forEach((c) => {
      steps.push({
        heading: tf("autoChangedH", { x: compName(c.id) }),
        body: tf("autoChangedB", { n: c.files, a: c.additions, d: c.deletions }),
        view: "architecture",
        focus: [c.id],
      });
    });
  if (OS && REQS.length) {
    for (const c of OS.changes) {
      if (c.requirements.length) {
        steps.push({
          heading: tf("autoSpecH", { n: c.requirements.length, id: c.id }),
          body: c.why || T.autoSpecB,
          view: "requirements",
          focus: c.requirements.map((r) => r.id),
        });
      }
    }
  }
  return steps;
}
export const STORY: StoryStep[] = ex?.story.length ? ex.story : autoStory();
export const storyIsAuto = !ex?.story.length;

/**
 * Untouched components worth drawing by default: the change adds or removes their link to it, breaks a rule with
 * it, or makes it the key dependency; or the story or the requirements point at them. The rest is context, one
 * click away. A link that only gains or loses references (116 → 117) is no reason: in the surveyed reports it drew
 * 12 of 13 neighbors. Nor is a rule the code broke before this change.
 */
export const MEANINGFUL = new Set<string>();
for (const e of facts.dependencies) {
  if (
    e.delta === "added" ||
    e.delta === "removed" ||
    isNewViolation(e) ||
    keyPairs[`${e.from}>${e.to}`] !== undefined
  ) {
    MEANINGFUL.add(e.from);
    MEANINGFUL.add(e.to);
  }
}
for (const step of STORY)
  if ((step.view ?? "architecture") === "architecture") for (const id of step.focus ?? []) MEANINGFUL.add(id);
for (const m of Object.values(specMap)) for (const id of m.components ?? []) MEANINGFUL.add(id);
export const isContext = (c: ComponentFacts) => c.delta === "unchanged" && !MEANINGFUL.has(c.id);
export const CONTEXT_COUNT = facts.components.filter(isContext).length;
