/**
 * The eval's model calls outside the agent under test: the judge (review, grounded, pairwise) and the writer of
 * the assertions. Each call is lean: no tools, no MCP servers, no skills or settings, and a 1-line system prompt, so
 * it costs the question it asks and nothing else (about 600 tokens of overhead, against 20k+ for a default
 * `claude -p`). The prompt goes on stdin. `spent()` is what the calls cost so far.
 */
import { spawnSync } from "node:child_process";
import type { Explanation } from "../src/contract/explanation.ts";
import type { Facts } from "../src/contract/facts.ts";
import {
  type Assertion,
  type Group,
  judgeView,
  parseVerdicts,
  RUBRIC,
  reviewPrompt,
  toVerdicts,
  type Verdict,
} from "./eval-graders.ts";
import { argv } from "./eval-metrics.ts";

const SYSTEM = "You are a strict, literal grader. You answer only with the JSON asked for.";
let cost = 0;
export const spent = () => cost;

/** 1 lean call: the model's text, or null when the call fails. */
export function askModel(command: string, model: string, prompt: string, system = SYSTEM): string | null {
  const [cmd, ...args] = argv(command) as [string, ...string[]];
  const run = spawnSync(
    cmd,
    [
      ...args,
      "--model",
      model,
      "--output-format",
      "json",
      "--tools",
      "",
      "--system-prompt",
      system,
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--setting-sources",
      "",
      "--no-session-persistence",
    ],
    { input: prompt, encoding: "utf8", timeout: 10 * 60_000, maxBuffer: 64 * 1024 * 1024 },
  );
  try {
    const out = JSON.parse(run.stdout) as { result?: string; total_cost_usd?: number; is_error?: boolean };
    cost += out.total_cost_usd ?? 0;
    return out.is_error ? null : String(out.result ?? "");
  } catch {
    return null;
  }
}

/** At most this many lines of code reach the judge for 1 piece of evidence. */
const EXCERPT_LINES = 80;

/**
 * The lines a location points at, at the head of the change (the clone of a PR stays on its base), with the hunk
 * around them: a why lives in the change around the line, not on the line alone. At most EXCERPT_LINES.
 */
export function excerpt(repo: string, facts: Facts, location: string): string {
  const m = /^(.+):(\d+)(?:-(\d+))?$/.exec(location);
  if (!m) return "";
  const show = spawnSync("git", ["show", `${facts.source.headSha}:${m[1]}`], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (show.status !== 0) return "";
  const lines = show.stdout.split("\n");
  const from = Number(m[2]);
  const to = Number(m[3] ?? m[2]);
  const hunk = facts.files
    .find((f) => f.path === m[1])
    ?.hunks.find((h) => h.newStart <= to && from < h.newStart + h.newLines);
  let a = Math.max(Math.min(from, hunk?.newStart ?? from) - 3, 1);
  let b = Math.max(to, hunk ? hunk.newStart + hunk.newLines - 1 : to) + 3;
  if (b - a + 1 > EXCERPT_LINES) {
    // Too long: the window around the evidence itself.
    a = Math.max(Math.round((from + to) / 2) - EXCERPT_LINES / 2, a);
    b = a + EXCERPT_LINES - 1;
  }
  return lines.slice(a - 1, b).join("\n");
}

/** At most this many characters of each source the judge reads: the PR description, the OpenSpec documents. */
const SOURCE_CHARS = 12_000;

/**
 * The sources a decision's basis names, in full: the digest quotes the PR description cut short and lists the
 * OpenSpec design decisions by title only. The OpenSpec proposal and design are read at the head of the change
 * (at the base for a change the diff deletes).
 */
export function sourcesOf(repo: string, facts: Facts): { pr: string; spec: string } {
  const show = (ref: string, path: string) =>
    spawnSync("git", ["show", `${ref}:${path}`], { cwd: repo, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).stdout ??
    "";
  const spec = (facts.openspec?.changes ?? [])
    .flatMap((c) =>
      c.artifacts
        .filter((a) => a.kind === "proposal" || a.kind === "design")
        .map((a) => `## ${a.path}\n${show(c.deleted ? facts.source.mergeBase : facts.source.headSha, a.path)}`),
    )
    .join("\n\n");
  return { pr: facts.source.description.slice(0, SOURCE_CHARS), spec: spec.slice(0, SOURCE_CHARS) };
}

const rubricIds = new Set(RUBRIC.map((r) => r.id));

/** The review call: the example's llm assertions (content) and the rubric (prose), 1 verdict each. */
export function review(
  command: string,
  model: string,
  facts: Facts,
  ex: Explanation,
  assertions: Assertion[],
): Verdict[] {
  const { ask, ids } = reviewPrompt(facts.source.title, ex, assertions);
  const answer = askModel(command, model, ask);
  const groupOf = (id: string): Group => (rubricIds.has(id) ? "prose" : "content");
  return toVerdicts(answer === null ? null : parseVerdicts(answer), ids, groupOf);
}

/**
 * The grounded call: for each decision with a basis other than inferred, does the source it names (the PR
 * description, the OpenSpec proposal and design, the code at its evidence) state its why?
 */
export function grounded(command: string, model: string, repo: string, facts: Facts, ex: Explanation): Verdict[] {
  const claims = (ex.decisions ?? [])
    .map((d, i) => ({ d, id: `decisions[${i}]-grounded` }))
    .filter(({ d }) => d.basis !== "inferred");
  if (!claims.length) return [];
  const items = claims.map(({ d, id }) => ({
    id,
    basis: d.basis,
    title: d.title,
    why: d.why,
    source: d.basis === "code" && d.evidence ? excerpt(repo, facts, d.evidence) : null,
  }));
  const sources = sourcesOf(repo, facts);
  const ask =
    "For each decision below, answer pass if its source states or directly shows its why, else fail. Sources: basis " +
    "pr = the PR description in <pr>; spec = the OpenSpec proposal and design in <spec>; code = the excerpt given " +
    "with it. A why the source does not support fails, even when it is plausible. Answer unknown only when the " +
    "source is missing. Give a reason of at most 15 words.\n" +
    'Answer only with JSON: [{"id": "...", "verdict": "pass" | "fail" | "unknown", "reason": "..."}].\n\n' +
    `<pr>\n${sources.pr}\n</pr>\n\n<spec>\n${sources.spec}\n</spec>\n\n<decisions>\n${JSON.stringify(items, null, 1)}\n</decisions>`;
  const answer = askModel(command, model, ask);
  return toVerdicts(
    answer === null ? null : parseVerdicts(answer),
    claims.map((c) => c.id),
    () => "grounded",
  );
}

/** 1 blind comparison: which explanation serves a reviewer better, or a tie. null when the answer cannot be read. */
function compareOnce(
  command: string,
  model: string,
  title: string,
  assertions: Assertion[],
  a: Explanation,
  b: Explanation,
): "A" | "B" | "tie" | null {
  const ask =
    "2 explanations of the same pull request follow. Choose the one that lets a reviewer understand the change " +
    "better before reading the diff: it says what the change does and why (the points below are what a good " +
    "explanation of this PR says), says what behaves differently rather than which code moved, its decisions are " +
    "real choices, and it does not repeat itself. Length is not a merit. Answer tie only when neither is better.\n" +
    'Answer only with JSON: {"winner": "A" | "B" | "tie", "reason": "at most 20 words"}.\n\n' +
    `<pr-title>${title}</pr-title>\n\n<points>\n${assertions.map((x) => `- ${x.text}`).join("\n")}\n</points>\n\n` +
    `<explanation-A>\n${judgeView(a)}\n</explanation-A>\n\n<explanation-B>\n${judgeView(b)}\n</explanation-B>`;
  const answer = askModel(command, model, ask);
  const m = answer && /"winner"\s*:\s*"(A|B|tie)"/.exec(answer);
  return m ? (m[1] as "A" | "B" | "tie") : null;
}

/**
 * Blind pairwise comparison of `before` and `now`, asked in both orders: a verdict that changes with the order is
 * position bias, counted as a tie. null when an answer cannot be read.
 */
export function pairwise(
  command: string,
  model: string,
  title: string,
  assertions: Assertion[],
  before: Explanation,
  now: Explanation,
): "now" | "before" | "tie" | null {
  const first = compareOnce(command, model, title, assertions, before, now);
  const second = compareOnce(command, model, title, assertions, now, before);
  if (!first || !second) return null;
  const one = first === "A" ? "before" : first === "B" ? "now" : "tie";
  const two = second === "A" ? "now" : second === "B" ? "before" : "tie";
  return one === two ? one : "tie";
}
