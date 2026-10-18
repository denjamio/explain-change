/**
 * The measures of the eval (scripts/eval.ts), kept apart so tests can check them without an agent: fidelity to
 * the reference as F1, the draft's own fidelity (what an agent that changes nothing scores) and the agent's lift
 * over it, and what an agent's transcript says about its work (turns, renders, tokens, the skill it loaded).
 */
import type { Explanation } from "../src/contract/explanation.ts";

export const PARTS = ["keyDeps", "flowEdges", "storyFocus", "decisionFiles"] as const;
export type Part = (typeof PARTS)[number];
export type Parts = Record<Part, number | null>;

/**
 * F1 of the agent's items against the reference's: recall (the reference's items the agent has) and precision (the
 * agent's items the reference has) together, so naming everything does not score. null when both are empty.
 */
export function f1(reference: string[], agent: string[]): number | null {
  const want = new Set(reference);
  const have = new Set(agent);
  if (!want.size && !have.size) return null;
  const hit = [...have].filter((x) => want.has(x)).length;
  return hit ? (2 * hit) / (want.size + have.size) : 0;
}

/** A value the draft leaves to the agent ("<component-id>"): never an item of a measure. */
const filled = (x: string) => x !== "" && !x.includes("<");

/** The items each part measures, as `from->to`, component ids and file paths. */
export function items(e: Explanation, part: Part): string[] {
  const pick = {
    keyDeps: () => (e.keyDependencies ?? []).map((k) => `${k.from}->${k.to}`),
    flowEdges: () => (e.flows ?? []).flatMap((f) => (f.steps ?? []).map((s) => `${s.from}->${s.to}`)),
    storyFocus: () =>
      (e.story ?? []).filter((s) => (s.view ?? "architecture") === "architecture").flatMap((s) => s.focus ?? []),
    decisionFiles: () => (e.decisions ?? []).map((d) => (d.evidence ?? "").split(":")[0] as string),
  }[part];
  return pick().filter(filled);
}

export const round = (v: number) => Math.round(v * 100) / 100;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * How close an explanation is to the reference, on what the facts let both see: each part is an F1 in 0-1 and
 * `fidelity` is the mean of the parts that apply. It measures structure, not wording.
 */
export function fidelity(
  reference: Explanation | null,
  other: Explanation | null,
): Parts & { fidelity: number | null } {
  const parts = Object.fromEntries(
    PARTS.map((p) => [p, reference && other ? f1(items(reference, p), items(other, p)) : null]),
  ) as Parts;
  const known = PARTS.map((p) => parts[p]).filter((v): v is number => v !== null);
  return {
    fidelity: known.length ? round(mean(known)) : null,
    ...(Object.fromEntries(PARTS.map((p) => [p, parts[p] === null ? null : round(parts[p] as number)])) as Parts),
  };
}

/**
 * What the agent adds to the draft: the mean, over the parts both measure, of the agent's F1 minus the draft's.
 * The draft already holds the outline's focus, key dependency and flows, so the fidelity alone partly measures
 * whether the agent kept them; 0 is an agent that changed nothing, and below 0 one that moved away from the
 * reference.
 */
export function lift(agent: Parts, draft: Parts): number | null {
  const both = PARTS.filter((p) => agent[p] !== null && draft[p] !== null);
  return both.length ? round(mean(both.map((p) => (agent[p] as number) - (draft[p] as number)))) : null;
}

/** What a `claude -p --output-format stream-json --verbose` transcript says about the agent's work. */
export interface Transcript {
  turns: number | null;
  costUsd: number | null;
  /** Prompt tokens, cached or not, and output tokens, over the whole run. */
  tokensIn: number | null;
  tokensOut: number | null;
  /** Of tokensIn: read from the prompt cache (cheap) and written to it. */
  tokensCacheRead: number | null;
  tokensCacheWrite: number | null;
  /** `explain-change render` calls: 1 is a first-time valid explanation, each more is a round of fixes. */
  renders: number;
  /** Reads of the sources outside the work folder (Read, or a shell command): the digest is meant to be enough. */
  sourceReads: number;
  /** The skills the agent loaded with the Skill tool, in order. */
  skills: string[];
  /** The issues the first render reported, numbers and quotes left out: what made the agent render again. */
  firstIssues: string[];
  /** The messages of the first render's issues, as the agent read them: what a fix to the CLI must handle. */
  firstMessages: string[];
  /** Each tool call in order, as `Tool:what (input chars→result chars)`: where the turns and the tokens go. */
  tools: string[];
}

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}
interface Block {
  type?: string;
  id?: string;
  tool_use_id?: string;
  content?: string | { type?: string; text?: string }[];
  name?: string;
  input?: { command?: string; file_path?: string; skill?: string; [key: string]: unknown };
}

/** Reads a transcript, one JSON event per line; a line that is not JSON is skipped. */
export function readTranscript(stdout: string): Transcript {
  const out: Transcript = {
    turns: null,
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    tokensCacheRead: null,
    tokensCacheWrite: null,
    renders: 0,
    sourceReads: 0,
    skills: [],
    firstIssues: [],
    firstMessages: [],
    tools: [],
  };
  const calls = new Map<string, number>();
  let firstRender: string | undefined;
  let firstSeen = false;
  for (const line of stdout.split("\n")) {
    let event: {
      type?: string;
      message?: { content?: Block[] };
      num_turns?: number;
      total_cost_usd?: number;
      usage?: Usage;
    };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "assistant") {
      for (const block of event.message?.content ?? []) {
        if (block.type !== "tool_use") continue;
        const input = block.input ?? {};
        const what = (input.file_path?.replace(/^.*[\\/]/, "") ?? String(input.command ?? input.skill ?? "")).slice(
          0,
          60,
        );
        calls.set(block.id ?? "", out.tools.push(`${block.name}:${what} (${JSON.stringify(input).length})`) - 1);
        if (block.name === "Bash" && /\bexplain-change\s+render\b/.test(input.command ?? "")) {
          out.renders++;
          firstRender ??= block.id;
        }
        if (block.name === "Read" && input.file_path && !/(^|[\\/])\.explain-change[\\/]/.test(input.file_path))
          out.sourceReads++;
        // Read-only shell commands (sed, grep, git show) run without a permission: they read the sources too.
        if (block.name === "Bash" && !/^\s*(cd \S+ && )?explain-change\b/.test(input.command ?? "")) out.sourceReads++;
        if (block.name === "Skill" && input.skill) out.skills.push(input.skill);
      }
    } else if (event.type === "user") {
      for (const b of event.message?.content ?? []) {
        const i = calls.get(b.tool_use_id ?? "");
        if (i === undefined) continue;
        const text = typeof b.content === "string" ? b.content : (b.content ?? []).map((c) => c.text ?? "").join("");
        out.tools[i] = (out.tools[i] as string).replace(/\)$/, `→${text.length})`);
      }
      if (!firstRender || firstSeen) continue;
      const result = (event.message?.content ?? []).find((b) => b.tool_use_id === firstRender);
      if (!result) continue;
      firstSeen = true;
      const text =
        typeof result.content === "string" ? result.content : (result.content ?? []).map((c) => c.text).join("\n");
      out.firstIssues = issueKinds(text);
      out.firstMessages = issueMessages(text);
    } else if (event.type === "result") {
      const u = event.usage ?? {};
      out.turns = event.num_turns ?? null;
      out.costUsd = event.total_cost_usd ?? null;
      out.tokensIn =
        (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) || null;
      out.tokensOut = u.output_tokens ?? null;
      out.tokensCacheRead = u.cache_read_input_tokens ?? null;
      out.tokensCacheWrite = u.cache_creation_input_tokens ?? null;
    }
  }
  return out;
}

/**
 * The kinds of the issues in a render's JSON output: each issue's code and path, indexes left out. Read object by
 * object, so an output the agent cut short (`| head`) still gives the issues it shows.
 */
export function issueKinds(text: string): string[] {
  return [...text.matchAll(/\{[^{}]*"code":[^{}]*\}/g)].map(([o]) => {
    const code = /"code":\s*"([^"]*)"/.exec(o)?.[1];
    const path = /"path":\s*"([^"]*)"/.exec(o)?.[1] ?? "";
    // a refused word is what to fix in the rules or the digest: keep it
    const words = code === "refused-word" ? ` (${/"message":\s*"([^":]*):/.exec(o)?.[1] ?? "?"})` : "";
    return `${code} ${path.replace(/\[\d+\]/g, "[]")}${words}`.trim();
  });
}

/** Each issue of a render's output as `path: message`, placeholders left out. */
export function issueMessages(text: string): string[] {
  return [...text.matchAll(/\{[^{}]*"code":[^{}]*\}/g)].flatMap(([o]) => {
    if (/"code":\s*"placeholder"/.test(o)) return [];
    const path = /"path":\s*"([^"]*)"/.exec(o)?.[1] ?? "";
    const message = /"message":\s*"((?:[^"\\]|\\.)*)"/.exec(o)?.[1] ?? "";
    return [`${path}: ${message}`];
  });
}

/** "mean ± sd" of the numbers in `xs`, or null when there are none. */
export function spread(xs: unknown[]): string | null {
  const n = xs.filter((x): x is number => typeof x === "number");
  if (!n.length) return null;
  const m = mean(n);
  const sd = Math.sqrt(mean(n.map((x) => (x - m) ** 2)));
  const r = Math.abs(m) >= 100 ? Math.round : round; // token counts read as whole numbers
  return n.length > 1 ? `${r(m)} ± ${r(sd)}` : String(r(m));
}

/** The measures --baseline compares: higher is better for each. */
export const COMPARED = ["score", "structure", "content", "prose", "grounded", "fidelity", "lift"] as const;

export interface Comparison {
  measure: string;
  before: number;
  now: number;
  delta: number;
  /** The mean dropped by more than the noise: 2 standard errors of the difference, at least NOISE_FLOOR. */
  regressed: boolean;
}
/**
 * 2 evals of the same code (haiku, 2 PRs, 3 runs each, 2026-10-17) differed by 0.06 in lift and 0.02 in fidelity:
 * below this, a drop is noise at the sizes the eval runs.
 */
const NOISE_FLOOR = 0.1;

/** Compares 2 evals run by run: the valid share and each measure both have. */
export function compareRuns(before: Record<string, unknown>[], now: Record<string, unknown>[]): Comparison[] {
  const nums = (rows: Record<string, unknown>[], k: string) =>
    rows.map((r) => r[k]).filter((v): v is number => typeof v === "number");
  const sd = (xs: number[]) => {
    const m = mean(xs);
    return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
  };
  const validShare = (rows: Record<string, unknown>[]) =>
    rows.length ? rows.filter((r) => r.state === "valid").length / rows.length : 0;
  const out: Comparison[] = [];
  const b = validShare(before);
  const n = validShare(now);
  out.push({ measure: "valid", before: round(b), now: round(n), delta: round(n - b), regressed: n < b });
  for (const k of COMPARED) {
    const xb = nums(before, k);
    const xn = nums(now, k);
    if (!xb.length || !xn.length) continue;
    const delta = mean(xn) - mean(xb);
    const noise = Math.max(2 * Math.sqrt(sd(xb) ** 2 / xb.length + sd(xn) ** 2 / xn.length), NOISE_FLOOR);
    out.push({
      measure: k,
      before: round(mean(xb)),
      now: round(mean(xn)),
      delta: round(delta),
      regressed: -delta > noise,
    });
  }
  return out;
}

/** An agent command line as argv: words split on any run of spaces. */
export const argv = (command: string): string[] => command.trim().split(/\s+/).filter(Boolean);
