/*
 * The story steps you read, per PR (a branch: per change) and head, kept in localStorage. At the next head of a PR,
 * a step stays read only when nothing it shows changed since your review: the same rule, and the same mark, as the
 * map and the changes use.
 */

import type { FileFacts } from "../src/contract/facts.ts";
import { store } from "./dom.ts";
import { compById, facts, fileIndex, SINCE, type StoryStep, src } from "./model.ts";

/** At most this many heads of one PR are kept. */
const KEEP = 5;
// One file:// origin can hold every report: the key names the PR, or the change of a branch.
const KEY = `ec:viewed:${src.kind === "pr" && src.url ? src.url : `local:${facts.key}`}`;

/** The components a step shows: its focus on the map or a flow, and the component of its code. */
function stepComponents(stp: StoryStep): string[] {
  const out = new Set((stp.focus ?? []).filter((id) => compById[id]));
  const file = stp.code ? (/^(.+?):\d/.exec(stp.code)?.[1] ?? null) : null;
  const f = file !== null ? (facts.files[fileIndex[file] ?? -1] as FileFacts | undefined) : undefined;
  if (f?.component) out.add(f.component);
  return [...out].sort();
}

/** What a step stands for across explanations of the PR: its view and components (its heading when it has none). */
const stepKey = (stp: StoryStep) => {
  const comps = stepComponents(stp);
  return `${stp.view ?? "architecture"}:${comps.length ? comps.join(",") : stp.heading}`;
};

/** Whether what a step shows changed since your review: new or changed again, else null. */
export function stepSince(stp: StoryStep): "new" | "again" | null {
  if (!SINCE) return null;
  const file = stp.code ? (/^(.+?):\d/.exec(stp.code)?.[1] ?? "") : "";
  const all = [...stepComponents(stp).map((c) => SINCE?.components[c]), file ? SINCE.files[file] : undefined];
  return all.includes("new") ? "new" : all.includes("again") ? "again" : null;
}

type Saved = Record<string, string[]>;

function load(story: StoryStep[]): Set<string> {
  const saved = store<Saved>(KEY) ?? {};
  const here = saved[src.headSha];
  if (here) return new Set(here);
  // A new head: what you read at your review stays read where nothing it shows changed since.
  const before = SINCE ? new Set(saved[SINCE.head] ?? []) : new Set<string>();
  return new Set(story.filter((s) => before.has(stepKey(s)) && !stepSince(s)).map(stepKey));
}

function save(keys: Set<string>) {
  const saved = store<Saved>(KEY) ?? {};
  delete saved[src.headSha];
  const heads = Object.keys(saved).slice(-(KEEP - 1));
  const next: Saved = {};
  for (const h of heads) next[h] = saved[h] as string[];
  next[src.headSha] = [...keys];
  store(KEY, next);
}

/** The read steps of this story: read(i), mark(i), and clear() to start over. */
export function viewedSteps(story: StoryStep[]) {
  const keys = load(story);
  return {
    read: (i: number) => keys.has(stepKey(story[i] as StoryStep)),
    count: () => story.filter((s) => keys.has(stepKey(s))).length,
    mark(i: number) {
      const stp = story[i];
      if (!stp || keys.has(stepKey(stp))) return;
      keys.add(stepKey(stp));
      save(keys);
    },
    clear() {
      keys.clear();
      save(keys);
    },
  };
}
