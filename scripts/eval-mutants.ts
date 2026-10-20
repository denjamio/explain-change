/**
 * Known-bad explanations for the eval's meta-eval (`bun run eval -- --calibrate`): each mutant breaks a good
 * explanation in one known way, and names the graders that must catch it. A grader that passes the good explanation
 * and still passes its mutant does not discriminate: its score cannot move when the agent gets better or worse.
 * Mutants are deterministic: the same explanation and facts give the same mutants.
 */

import type { Explanation } from "../src/contract/explanation.ts";
import type { Facts } from "../src/contract/facts.ts";
import { churn, inChange, type Verdict } from "./eval-graders.ts";

export interface Mutant {
  kind: string;
  /** Grader ids that must fail on the mutant; `group:<group>` means any grader of that group. */
  targets: string[];
  explanation: Explanation;
  /** The mutant changes prose the judge reads: it needs a review call. */
  review: boolean;
  /** The mutant changes a decision's why: it needs a grounded call. */
  grounded: boolean;
}

const clone = (ex: Explanation) => structuredClone(ex) as Explanation;

/** The component with the most changed code: the one a reader cannot do without. */
function biggestComponent(facts: Facts): string | null {
  const lines = [...churn(facts)].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return lines[0]?.[0] ?? null;
}

/** The explanation with a component left out of the story, the flows, the data model and the summaries. */
function without(good: Explanation, id: string): Explanation {
  const ex = clone(good);
  for (const step of ex.story) if (step.focus) step.focus = step.focus.filter((f) => f !== id);
  for (const flow of ex.flows ?? []) flow.steps = flow.steps.filter((s) => s.from !== id && s.to !== id);
  for (const entity of ex.dataModel?.entities ?? []) if (entity.component === id) delete entity.component;
  for (const r of ex.requirements ?? []) if (r.components) r.components = r.components.filter((c) => c !== id);
  if (ex.components) ex.components = ex.components.filter((c) => c.id !== id);
  if (ex.keyDependencies) ex.keyDependencies = ex.keyDependencies.filter((k) => k.from !== id && k.to !== id);
  return ex;
}

/** A line of a changed code file that no hunk touches, or null. */
function lineOutsideChange(facts: Facts): string | null {
  for (const f of facts.files) {
    if (f.category !== "code" || f.delta !== "changed" || !f.hunks.length) continue;
    const last = f.hunks[f.hunks.length - 1] as (typeof f.hunks)[number];
    for (const line of [1, last.newStart + last.newLines + 40]) {
      if (!inChange(facts, `${f.path}:${line}`)) return `${f.path}:${line}`;
    }
  }
  return null;
}

/** The mutants of one good explanation; a mutant that cannot apply (no decision, a short story) is left out. */
export function mutants(facts: Facts, good: Explanation): Mutant[] {
  const out: Mutant[] = [];
  const add = (kind: string, targets: string[], explanation: Explanation, review = false, grounded = false) =>
    out.push({ kind, targets, explanation, review, grounded });

  const biggest = biggestComponent(facts);
  if (biggest) add("hide-biggest-component", ["story-coverage"], without(good, biggest));

  const touched = new Set(
    facts.dependencies.filter((d) => d.delta !== "unchanged" || d.violation).map((d) => `${d.from}->${d.to}`),
  );
  const quiet = facts.dependencyGraph.find(([a, b]) => a !== b && !touched.has(`${a}->${b}`));
  if (quiet) {
    const ex = clone(good);
    ex.keyDependencies = [{ from: quiet[0], to: quiet[1] }];
    add("untouched-key-dependency", ["key-dependency-changed"], ex);
  }

  const outside = lineOutsideChange(facts);
  const cited = (good.decisions ?? []).findIndex((d) => d.evidence);
  if (outside && cited >= 0) {
    const ex = clone(good);
    (ex.decisions ?? [])[cited]!.evidence = outside;
    add("evidence-outside-change", ["evidence-in-change"], ex);
  }

  {
    const ex = clone(good);
    ex.tldr = "This change updates the code in several components.";
    ex.goal = "The code needs an update.";
    for (const step of ex.story) step.body = "This step changes the code of this part.";
    add("generic-prose", ["tldr-effect", "goal-need", "steps-behavior", "distinct-prose", "group:content"], ex, true);
  }

  const files = facts.files
    .filter((f) => f.category === "code")
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions) || (a.path < b.path ? -1 : 1))
    .slice(0, 3)
    .map((f) => f.path.split("/").pop());
  if (files.length) {
    const ex = clone(good);
    ex.tldr = `Changes ${files.join(", ")}.`;
    add("tldr-lists-files", ["tldr-effect"], ex, true);
  }

  {
    const ex = clone(good);
    ex.goal = good.tldr;
    add("goal-repeats-tldr", ["goal-need", "distinct-prose"], ex, true);
  }

  if (good.decisions?.length) {
    const ex = clone(good);
    (ex.decisions ?? []).forEach((d, i) => {
      const step = good.story[i % good.story.length] as (typeof good.story)[number];
      d.title = step.heading;
      d.why = step.body;
    });
    add("decisions-restate-change", ["decisions-choices"], ex, true);
  }

  const grounded = (good.decisions ?? []).findIndex((d) => d.basis !== "inferred");
  if (grounded >= 0) {
    const ex = clone(good);
    (ex.decisions ?? [])[grounded]!.why = "It stops data loss when 2 users save the same record at the same time.";
    add("fabricated-why", [`decisions[${grounded}]-grounded`], ex, false, true);
  }
  return out;
}

/**
 * Whether a mutant was caught: a target grader that passes on the good explanation fails on the mutant. `null`
 * when every target already fails (or does not apply) on the good one: the mutant measures nothing there.
 */
export function caught(targets: string[], good: Verdict[], bad: Verdict[]): boolean | null {
  const matches = (t: string, v: Verdict) => (t.startsWith("group:") ? v.group === t.slice(6) : v.id === t);
  const before = good.filter((v) => v.passed === true && targets.some((t) => matches(t, v)));
  if (!before.length) return null;
  return before.some((v) => bad.find((b) => b.id === v.id)?.passed === false);
}
