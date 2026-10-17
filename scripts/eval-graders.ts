/**
 * The graders of the eval (scripts/eval.ts), designed after `claude plugin eval` and skill-creator: each grader is a
 * pass/fail check on what the agent produced, with its evidence, and a run's score is the share of its graders that
 * pass. Kept apart from the agent and the judge so tests can check every grader offline.
 *
 * - structure: deterministic checks against the facts (free, no noise): the story covers the changed code, the key
 *   dependency is one the change touches, the evidence points into the change, flow steps exist in the code, the
 *   prose does not repeat itself.
 * - content: the example's assertions (examples/real/<name>/assertions.json), written once from the PR's diff and
 *   description, never from the tool's output: `mentions` ones are checked here, `llm` ones by the judge.
 * - prose: a rubric of PASS/FAIL conditions the judge checks on the explanation alone (short input, stable verdicts).
 * - grounded: per decision with a basis other than inferred, the judge checks that its source states the why.
 *
 * A grader that does not apply, or that the judge answers `unknown`, is `null`: it counts neither way.
 */
import type { Explanation } from "../src/contract/explanation.ts";
import type { Facts } from "../src/contract/facts.ts";
import { escapeRegExp } from "../src/core/text.ts";

export const GROUPS = ["structure", "content", "prose", "grounded"] as const;
export type Group = (typeof GROUPS)[number];

export interface Verdict {
  id: string;
  group: Group;
  /** null: does not apply, or the judge could not tell. */
  passed: boolean | null;
  evidence: string;
}

/** An assertion about one example: what a good explanation of that PR says. */
export interface Assertion {
  id: string;
  /** llm: the judge checks `text`; mentions: one of `any` appears in the prose, as a whole word. */
  kind: "llm" | "mentions";
  text: string;
  any?: string[];
}

export interface AssertionFile {
  $comment?: string;
  generated: { model: string; head: string };
  assertions: Assertion[];
}

/** The share of changed code lines the story must light for `story-coverage` to pass. */
export const COVERAGE_MIN = 0.8;
/** Word overlap (Jaccard) at which 2 fields of prose say the same thing. */
export const REPEAT_MAX = 0.5;
/** The share of flow steps that must exist in the code for `flows-verified` to pass. */
export const FLOWS_MIN = 0.8;
/** How far a decision's evidence line may sit from a hunk and still point into the change. */
const EVIDENCE_SLACK = 3;

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Changed lines of code and migrations per component: what the change is made of. */
export function churn(facts: Facts): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of facts.files) {
    if (!f.component || (f.category !== "code" && f.category !== "migration")) continue;
    out.set(f.component, (out.get(f.component) ?? 0) + f.additions + f.deletions);
  }
  return out;
}

/** The components the story lights: its focus, the participants of the flows it shows, the owners of its data. */
export function litComponents(ex: Explanation): Set<string> {
  const lit = new Set<string>();
  const flows = new Map((ex.flows ?? []).map((f) => [f.id, f]));
  const entities = new Map((ex.dataModel?.entities ?? []).map((e) => [e.id, e]));
  const requirements = new Map((ex.requirements ?? []).map((r) => [r.id, r]));
  for (const step of ex.story ?? []) {
    const view = step.view ?? "architecture";
    if (view === "architecture") for (const id of step.focus ?? []) lit.add(id);
    else if (view.startsWith("flow:")) {
      for (const s of flows.get(view.slice(5))?.steps ?? []) lit.add(s.from).add(s.to);
    } else if (view === "data") {
      for (const id of step.focus ?? []) {
        const component = entities.get(id)?.component;
        if (component) lit.add(component);
      }
    } else if (view === "requirements") {
      for (const id of step.focus ?? []) for (const c of requirements.get(id)?.components ?? []) lit.add(c);
    }
  }
  return lit;
}

function storyCoverage(facts: Facts, ex: Explanation): Verdict {
  const lines = churn(facts);
  const total = [...lines.values()].reduce((a, b) => a + b, 0);
  const verdict = (passed: boolean | null, evidence: string): Verdict => ({
    id: "story-coverage",
    group: "structure",
    passed,
    evidence,
  });
  if (!total) return verdict(null, "no changed code in a component");
  const lit = litComponents(ex);
  const covered = [...lines].filter(([c]) => lit.has(c)).reduce((a, [, n]) => a + n, 0);
  const missed = [...lines]
    .filter(([c, n]) => !lit.has(c) && n > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([c, n]) => `${c} (${n})`);
  const share = covered / total;
  return verdict(
    share >= COVERAGE_MIN,
    `lights ${pct(share)} of ${total} changed code lines${missed.length ? `; misses ${missed.join(", ")}` : ""}`,
  );
}

function keyDependencyChanged(facts: Facts, ex: Explanation): Verdict {
  const id = "key-dependency-changed";
  const keys = ex.keyDependencies ?? [];
  const candidates = facts.outline.keyDependencyCandidates;
  if (!keys.length) {
    return candidates.length
      ? { id, group: "structure", passed: false, evidence: "no key dependency; the facts have candidates" }
      : { id, group: "structure", passed: null, evidence: "no key dependency and no candidate" };
  }
  const touched = new Set(
    facts.dependencies.filter((d) => d.delta !== "unchanged" || d.violation).map((d) => `${d.from}->${d.to}`),
  );
  const off = keys.map((k) => `${k.from}->${k.to}`).filter((k) => !touched.has(k));
  return {
    id,
    group: "structure",
    passed: off.length === 0,
    evidence: off.length
      ? `the change does not touch ${off.join(", ")}`
      : "every key dependency is one the change touches",
  };
}

/** True when `file:line` points at a line inside a hunk of the change (at the head, or at the base for a removal). */
export function inChange(facts: Facts, location: string): boolean {
  const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(location);
  if (!m) return false;
  const file = facts.files.find((f) => f.path === m[1]);
  if (!file) return false;
  const first = Number(m[2]);
  const last = Number(m[3] ?? m[2]);
  return file.hunks.some((h) => {
    const [start, count] = file.delta === "removed" ? [h.oldStart, h.oldLines] : [h.newStart, h.newLines];
    return first <= start + count + EVIDENCE_SLACK && last >= start - EVIDENCE_SLACK;
  });
}

function evidenceInChange(facts: Facts, ex: Explanation): Verdict {
  const id = "evidence-in-change";
  const cited = (ex.decisions ?? []).map((d, i) => [i, d.evidence] as const).filter(([, e]) => e && !e.includes("<"));
  if (!cited.length) return { id, group: "structure", passed: null, evidence: "no decision cites evidence" };
  const off = cited.filter(([, e]) => !inChange(facts, e as string)).map(([i, e]) => `decisions[${i}] ${e}`);
  return {
    id,
    group: "structure",
    passed: off.length === 0,
    evidence: off.length ? `outside the change: ${off.join(", ")}` : `${cited.length} citations inside the change`,
  };
}

function flowsVerified(facts: Facts, ex: Explanation): Verdict {
  const id = "flows-verified";
  const steps = (ex.flows ?? []).flatMap((f) => (f.steps ?? []).map((s) => [f.id, s.from, s.to] as const));
  if (!steps.length) return { id, group: "structure", passed: null, evidence: "no flow" };
  const edges = new Set([
    ...facts.dependencyGraph.map(([a, b]) => `${a}->${b}`),
    ...facts.ports.map((p) => `${p.from}->${p.to}`),
  ]);
  const unverified = steps.filter(([, a, b]) => a !== b && !edges.has(`${a}->${b}`));
  const share = 1 - unverified.length / steps.length;
  return {
    id,
    group: "structure",
    passed: share >= FLOWS_MIN,
    evidence: unverified.length
      ? `${unverified.length}/${steps.length} steps with no dependency in the code: ${unverified
          .map(([f, a, b]) => `${f}: ${a}->${b}`)
          .join(", ")}`
      : `${steps.length} steps, each a dependency in the code`,
  };
}

const STOP = new Set(
  "a an and are as at be by for from has have in into is it its now of on or that the their then this to was when which with without".split(
    " ",
  ),
);
/** The content words of a text: lowercase, 3+ letters, no stop words. */
export const contentWords = (text: string) =>
  new Set((text.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? []).filter((w) => !STOP.has(w)));

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((w) => b.has(w)).length;
  return shared / (a.size + b.size - shared);
}

/** The fields of prose, by JSON path, that say what the change does. */
export function proseFields(ex: Explanation): [string, string][] {
  const out: [string, string][] = [
    ["tldr", ex.tldr],
    ["goal", ex.goal],
  ];
  (ex.story ?? []).forEach((s, i) => {
    out.push([`story[${i}].body`, s.body]);
  });
  (ex.decisions ?? []).forEach((d, i) => {
    out.push([`decisions[${i}].why`, d.why]);
  });
  return out.filter(([, t]) => typeof t === "string" && t.trim() !== "" && !t.includes("<"));
}

function distinctProse(ex: Explanation): Verdict {
  const fields = proseFields(ex).map(([path, text]) => [path, contentWords(text)] as const);
  const repeats: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    for (let j = i + 1; j < fields.length; j++) {
      const [pa, a] = fields[i] as (typeof fields)[number];
      const [pb, b] = fields[j] as (typeof fields)[number];
      const overlap = jaccard(a, b);
      if (overlap >= REPEAT_MAX) repeats.push(`${pa} ~ ${pb} (${pct(overlap)})`);
    }
  }
  return {
    id: "distinct-prose",
    group: "structure",
    passed: repeats.length === 0,
    evidence: repeats.length ? `repeats: ${repeats.join(", ")}` : `${fields.length} fields, none repeats another`,
  };
}

/** The deterministic graders: what the facts can check without a judge. */
export function structureGraders(facts: Facts, ex: Explanation | null, valid: boolean): Verdict[] {
  const validity: Verdict = {
    id: "valid",
    group: "structure",
    passed: valid,
    evidence: valid ? "render accepts it" : "render rejects it",
  };
  if (!ex) return [validity];
  return [
    validity,
    storyCoverage(facts, ex),
    keyDependencyChanged(facts, ex),
    evidenceInChange(facts, ex),
    flowsVerified(facts, ex),
    distinctProse(ex),
  ];
}

/** Every piece of prose the reader sees, for `mentions` assertions. */
export function allProse(ex: Explanation): string {
  return [
    ex.tldr,
    ex.goal,
    ...(ex.story ?? []).flatMap((s) => [s.heading, s.body]),
    ...(ex.components ?? []).map((c) => c.summary),
    ...(ex.decisions ?? []).flatMap((d) => [d.title, d.why, d.alternative ?? ""]),
    ...(ex.flows ?? []).flatMap((f) => [f.title, ...(f.steps ?? []).map((s) => s.call)]),
    ...(ex.dataModel?.entities ?? []).flatMap((e) => [e.name, ...(e.fields ?? [])]),
    ...(ex.requirements ?? []).map((r) => r.note ?? ""),
  ]
    .filter((t): t is string => typeof t === "string")
    .join("\n");
}

/** The `mentions` assertions, checked as whole words, case-insensitive. */
export function mentionGraders(ex: Explanation | null, assertions: Assertion[]): Verdict[] {
  const prose = ex ? allProse(ex) : "";
  return assertions
    .filter((a) => a.kind === "mentions")
    .map((a) => {
      const hit = (a.any ?? []).find((term) =>
        new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`, "iu").test(prose),
      );
      return {
        id: a.id,
        group: "content" as const,
        passed: ex ? hit !== undefined : false,
        evidence: hit ? `names ${hit}` : `names none of ${(a.any ?? []).join(", ")}`,
      };
    });
}

/** The rubric the judge applies to every explanation: concrete PASS and FAIL conditions. */
export const RUBRIC: { id: string; text: string }[] = [
  {
    id: "tldr-effect",
    text:
      "PASS if tldr says what changes and its effect for a user or for the system. FAIL if it only lists files, " +
      "classes or components, or only says that code changed.",
  },
  {
    id: "goal-need",
    text:
      "PASS if goal states the need or the problem behind the change. FAIL if it repeats the tldr in other words, " +
      "or describes the code instead of the need.",
  },
  {
    id: "steps-behavior",
    text:
      "PASS if every story body but the last says what behaves differently. FAIL if one of them only describes code " +
      "structure (a class is added, a file changes) and not what it does, or if 2 of them say the same thing. The " +
      "last step is the overview of the whole change: it may sum up the others and describe the architecture.",
  },
  {
    id: "decisions-choices",
    text:
      "PASS if each decision names a choice between real options and its alternative is a real option a team could " +
      "take. FAIL if a decision only restates what the change does, or its alternative is only 'not doing it'. " +
      "PASS when there are no decisions.",
  },
];

/** The explanation as the judge reads it: one line per field, with its JSON path. */
export function judgeView(ex: Explanation): string {
  const lines = [`tldr: ${ex.tldr}`, `goal: ${ex.goal}`];
  (ex.story ?? []).forEach((s, i) => {
    lines.push(`story[${i}] (${s.view ?? "architecture"}; ${(s.focus ?? []).join(", ")}) ${s.heading}: ${s.body}`);
  });
  for (const k of ex.keyDependencies ?? [])
    lines.push(`key dependency: ${k.from} -> ${k.to}${k.label ? ` (${k.label})` : ""}`);
  for (const c of ex.components ?? []) lines.push(`component ${c.id}: ${c.summary}`);
  (ex.flows ?? []).forEach((f) => {
    lines.push(
      `flow ${f.id} "${f.title}": ${(f.steps ?? []).map((s) => `${s.from} -> ${s.to}: ${s.call}`).join("; ")}`,
    );
  });
  for (const e of ex.dataModel?.entities ?? [])
    lines.push(`entity ${e.name} (${e.delta}): ${(e.fields ?? []).join(", ")}`);
  (ex.decisions ?? []).forEach((d, i) => {
    lines.push(
      `decisions[${i}] ${d.title}. Why (${d.basis}): ${d.why}${d.alternative ? ` Alternative: ${d.alternative}` : ""}`,
    );
  });
  for (const r of ex.requirements ?? []) lines.push(`requirement ${r.id}: ${r.status}${r.note ? ` (${r.note})` : ""}`);
  return lines.join("\n");
}

/** The question for the review call: the example's llm assertions and the rubric, 1 verdict each. */
export function reviewPrompt(title: string, ex: Explanation, assertions: Assertion[]): { ask: string; ids: string[] } {
  const items = [
    ...assertions.filter((a) => a.kind === "llm").map((a) => ({ id: a.id, check: `PASS if it holds: ${a.text}` })),
    ...RUBRIC.map((r) => ({ id: r.id, check: r.text })),
  ];
  const ask =
    "You grade an explanation of a pull request, item by item. For each item, answer pass or fail by its condition, " +
    "from the explanation alone. An item passes when the explanation states its main point, in any words; a detail " +
    "it leaves out (a number, a name, a secondary condition) does not fail it. It fails when the main point is " +
    "missing or contradicted. Answer unknown only when the explanation cannot decide it. Give a reason of at most " +
    "15 words.\n" +
    'Answer only with JSON: [{"id": "...", "verdict": "pass" | "fail" | "unknown", "reason": "..."}], one entry per item.\n\n' +
    `<pr-title>${title}</pr-title>\n\n<explanation>\n${judgeView(ex)}\n</explanation>\n\n<items>\n` +
    `${JSON.stringify(items, null, 1)}\n</items>`;
  return { ask, ids: items.map((i) => i.id) };
}

export interface JudgeAnswer {
  id: string;
  verdict: "pass" | "fail" | "unknown";
  reason?: string;
}

/** The verdicts in a judge's answer, keyed by id, or null when the answer has no JSON array of them. */
export function parseVerdicts(text: string): Map<string, JudgeAnswer> | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) return null;
  try {
    const list = JSON.parse(text.slice(start, end + 1)) as JudgeAnswer[];
    if (!Array.isArray(list)) return null;
    return new Map(
      list
        .filter((v) => v && typeof v.id === "string" && ["pass", "fail", "unknown"].includes(v.verdict))
        .map((v) => [v.id, v]),
    );
  } catch {
    return null;
  }
}

/** Verdicts for `ids` from a judge's answers; an id the judge skipped, or answered unknown, is null. */
export function toVerdicts(
  answers: Map<string, JudgeAnswer> | null,
  ids: string[],
  groupOf: (id: string) => Group,
): Verdict[] {
  return ids.map((id) => {
    const a = answers?.get(id);
    return {
      id,
      group: groupOf(id),
      passed: a && a.verdict !== "unknown" ? a.verdict === "pass" : null,
      evidence: a ? `${a.verdict}: ${a.reason ?? ""}`.trim() : "no answer from the judge",
    };
  });
}

export const round = (v: number) => Math.round(v * 100) / 100;

/** The share of graders that pass, over those that apply: the run's score, overall and per group. */
export function scores(verdicts: Verdict[]): Record<"score" | Group, number | null> {
  const share = (vs: Verdict[]) => {
    const known = vs.filter((v) => v.passed !== null);
    return known.length ? round(known.filter((v) => v.passed).length / known.length) : null;
  };
  return {
    score: share(verdicts),
    ...(Object.fromEntries(GROUPS.map((g) => [g, share(verdicts.filter((v) => v.group === g))])) as Record<
      Group,
      number | null
    >),
  };
}

export interface GraderStat {
  example: string;
  id: string;
  group: Group;
  passed: number;
  failed: number;
  /** A failing run's evidence, to say what to fix. */
  sample: string;
}

/** Per example and grader: how many runs pass and fail it. pass^k is `failed === 0` over k runs. */
export function graderStats(rows: { example: string; graders?: Verdict[] }[]): GraderStat[] {
  const out = new Map<string, GraderStat>();
  for (const row of rows) {
    for (const v of row.graders ?? []) {
      if (v.passed === null) continue;
      const key = `${row.example}\u0000${v.id}`;
      const s = out.get(key) ?? { example: row.example, id: v.id, group: v.group, passed: 0, failed: 0, sample: "" };
      if (v.passed) s.passed++;
      else {
        s.failed++;
        s.sample ||= v.evidence;
      }
      out.set(key, s);
    }
  }
  return [...out.values()].sort((a, b) =>
    a.example === b.example ? (a.id < b.id ? -1 : 1) : a.example < b.example ? -1 : 1,
  );
}

export interface GraderChange {
  example: string;
  id: string;
  before: number;
  now: number;
}

/**
 * Grader by grader, the pass rate before and now, for the graders both evals ran on the same example: what an
 * iteration fixed and what it broke. A change of a single run out of 1 is noise; the caller sees the counts.
 */
export function graderChanges(
  before: GraderStat[],
  now: GraderStat[],
): { fixed: GraderChange[]; broke: GraderChange[] } {
  const rate = (s: GraderStat) => s.passed / (s.passed + s.failed);
  const old = new Map(before.map((s) => [`${s.example}\u0000${s.id}`, s]));
  const fixed: GraderChange[] = [];
  const broke: GraderChange[] = [];
  for (const s of now) {
    const b = old.get(`${s.example}\u0000${s.id}`);
    if (!b) continue;
    const change = { example: s.example, id: s.id, before: round(rate(b)), now: round(rate(s)) };
    if (change.now - change.before >= 0.5) fixed.push(change);
    else if (change.before - change.now >= 0.5) broke.push(change);
  }
  return { fixed, broke };
}

/** Two-sided sign test: how likely `wins` against `losses` (ties left out) is under a fair coin. */
export function signTest(wins: number, losses: number): number {
  const n = wins + losses;
  if (!n) return 1;
  const k = Math.min(wins, losses);
  let tail = 0;
  for (let i = 0; i <= k; i++) {
    let c = 1;
    for (let j = 0; j < i; j++) c = (c * (n - j)) / (j + 1);
    tail += c / 2 ** n;
  }
  return round(Math.min(1, 2 * tail));
}
