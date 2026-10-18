import { readFileSync } from "node:fs";
import { join } from "node:path";
import { specRequirements } from "../analysis/openspec.ts";
import type { Facts } from "../contract/facts.ts";
import { git, readBlobs } from "../core/git.ts";
import { escapeRegExp } from "../core/text.ts";
import en from "./prose/en.json" with { type: "json" };

/*
 * Prose: the parts of ASD-STE100 (Simplified Technical English) that help a design document, not its restricted
 * dictionary: technical names are the content and stay exactly as in the code. Enforced: sentence length, the
 * refused words (grouped by why, so each issue says what to write instead), the passive with its agent ("is called
 * by X") and code names that exist in the change. Code names are exempt from the word rules. The rest is guidance
 * the digest prints.
 */

export const MAX_SENTENCE_WORDS = 25;

export interface RefusedGroup {
  why: string;
  /** Whole words or phrases; a trailing `*` also matches every ending (`leverag*` = leverage, leveraged…). */
  words: string[];
}

export const REFUSED: RefusedGroup[] = en.refused;

/** Common product names written in CamelCase that are not code of the change; `project.names` adds more. */
export const PRODUCT_NAMES = new Set([
  "OpenSpec",
  "JavaScript",
  "TypeScript",
  "CoffeeScript",
  "GitHub",
  "GitLab",
  "DevOps",
  "PowerShell",
  "WebSocket",
  "WebSockets",
  "YouTube",
  "LinkedIn",
  "PayPal",
  "BigQuery",
  "CloudFront",
  "ActiveRecord",
  "ActiveJob",
  "ActionMailer",
  "ActionCable",
  "PubSub",
]);

const LETTER = String.raw`\p{L}\p{N}_`;
export const WORD_RE = /[\p{L}\p{N}_'’-]+/gu;
export const SENTENCE_SPLIT_RE = /(?<=[.!?;])\s+/u;
/** A piece that ends with one of these did not end a sentence: "e.g. the job" stays 1 sentence. */
const ABBREVIATION_RE = /(?:^|[^\p{L}])(?:e\.g|i\.e|etc|vs|cf|approx)\.$/iu;

/** The sentences of a field, an abbreviation's dot not counted as an end. */
export function sentences(value: string): string[] {
  const out: string[] = [];
  for (const piece of value.split(SENTENCE_SPLIT_RE)) {
    const last = out.length - 1;
    if (last >= 0 && ABBREVIATION_RE.test(out[last] as string)) out[last] = `${out[last]} ${piece}`;
    else out.push(piece);
  }
  return out;
}

/**
 * The passive with its agent: "is called by X", "are sent by the job". Rewritten active, X comes first ("X calls
 * it"). "by" for a manner ("sorted by date", "off by default") is not an agent and passes.
 */
const IRREGULAR_PARTICIPLES =
  "built|bought|brought|caught|chosen|done|drawn|driven|found|given|held|hidden|kept|known|led|left|made|paid|put|" +
  "read|run|seen|sent|set|shown|sold|spent|taken|taught|thrown|told|understood|written|overridden|rewritten";
const MANNER_PARTICIPLES = "sorted|ordered|grouped|keyed|indexed|filtered|scoped|partitioned|paginated|separated";
const MANNER_NOUNS = "default|design|hand|name|id|key|date|value|type|reference|position|size|time|day|month|year";
export const PASSIVE_RE = new RegExp(
  String.raw`(?<![\p{L}])(?:is|are|was|were|be|been|being)\s+(?:\p{L}+ly\s+)?` +
    String.raw`(?!(?:${MANNER_PARTICIPLES})(?![\p{L}]))((?:\p{L}{2,}ed|${IRREGULAR_PARTICIPLES}))` +
    String.raw`\s+by\s+(?!(?:${MANNER_NOUNS})(?![\p{L}]))(?=[\p{L}\p{N}])`,
  "giu",
);

/**
 * Code names in prose: `backticked`, Qualified::Name or obj.method(), snake_case, and CamelCase with 2+ humps. Each
 * must appear in the change or the repository.
 */
export const CODE_NAME_RE = new RegExp(
  "`([^`]+)`|" +
    `(?<![${LETTER}.])(` +
    String.raw`(?:[A-Za-z_]\w+(?:::|\.))+[A-Za-z_]\w+(?:\(\))?` +
    "|[a-z][a-z0-9]*(?:_[a-z0-9]+)+" +
    "|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+" +
    `)(?![${LETTER}])`,
  "gu",
);

/**
 * Counts as digits (ASD-STE100), applied to the page rather than refused: a refusal cost the agent a round of
 * fixes in most eval runs, and the rewrite is mechanical. Code names (`two_factor`) are words of their own and stay.
 */
const NUMBER_WORDS = ["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const NUMBER_RE = new RegExp(`(?<![${LETTER}\`])(${NUMBER_WORDS.join("|")})(?![${LETTER}\`])`, "giu");
export const digits = (text: string): string =>
  text.replace(NUMBER_RE, (w) => String(NUMBER_WORDS.indexOf(w.toLowerCase()) + 2));

/** One regex per refused group, matching whole words; `word*` matches the word with any ending. */
export function refusedPatterns(): [string, RegExp][] {
  return REFUSED.map((g) => {
    const words = g.words.map((w) =>
      w.endsWith("*") ? `${escapeRegExp(w.slice(0, -1))}[${LETTER}]*` : escapeRegExp(w),
    );
    return [g.why, new RegExp(`(?<![${LETTER}])(?:${words.join("|")})(?![${LETTER}])`, "gu")];
  });
}

/** The prose rules for the digest, with every word the validator refuses, written as the validator reads them. */
export function proseRules(names: readonly string[] = []): string {
  const refused = REFUSED.map((g) => `${g.why.split(";")[0]}: ${g.words.join(", ")}`).join("; ");
  return (
    `Simplified Technical English (ASD-STE100): one idea per sentence, at most ${MAX_SENTENCE_WORDS} words; ` +
    "active voice, present tense; the effect, not how good it is; simple verbs (adds, sends, stores, calls, checks, " +
    "replaces); one word per thing; counts as digits (3 files, the page writes them so), and 'a' for a single thing (a ZIP file, not 1 ZIP " +
    "file); no idioms. No passive with its agent: 'the job sends it', not 'it is sent by the job'. Code names " +
    "(snake_case, CamelCase, Module::Name, obj.method()) exactly as in the code; the word rules skip them. " +
    "Rewrite modals as facts: 'it would fail' → 'it fails'; 'it could send' → 'it sends' or 'it can send' (can is " +
    "allowed). " +
    (names.length ? `Product names that are not code: ${names.join(", ")}. ` : "") +
    `Refused (w* = w and its forms): ${refused}.`
  );
}

/** What is wrong with 1 field of prose. */
export interface ProseIssue {
  code: "sentence-too-long" | "refused-word" | "passive" | "unknown-code-name";
  message: string;
}

/** Checks prose against the rules and code names against the change (then the repository). */
export class ProseChecker {
  private readonly refused = refusedPatterns();
  private corpus: string | null = null;
  private readonly grepCache = new Map<string, boolean>();
  private readonly productNames: Set<string>;

  constructor(
    private readonly facts: Facts,
    private readonly root: string | null,
  ) {
    this.productNames = new Set([...PRODUCT_NAMES, ...facts.config.names]);
  }

  check(value: string, names: boolean): ProseIssue[] {
    const issues: ProseIssue[] = [];
    for (const sentence of sentences(value)) {
      const n = sentence.match(WORD_RE)?.length ?? 0;
      if (n > MAX_SENTENCE_WORDS) {
        issues.push({
          code: "sentence-too-long",
          message: `a sentence has ${n} words, max ${MAX_SENTENCE_WORDS}; split it`,
        });
        break;
      }
    }
    // Code names are the content: `ensure_admin` or EnsureTenant is not the word "ensure". X keeps "by X" whole.
    const low = value.replace(CODE_NAME_RE, "X").toLowerCase();
    for (const [why, rx] of this.refused) {
      const found = [...new Set([...low.matchAll(rx)].map((m) => m[0]))].sort();
      if (found.length) issues.push({ code: "refused-word", message: `${found.join(", ")}: ${why}` });
    }
    const passive = [...new Set([...low.matchAll(PASSIVE_RE)].map((m) => m[0].trim()))].sort();
    if (passive.length) {
      issues.push({
        code: "passive",
        message: `${passive.map((p) => `'${p} …'`).join(", ")}: passive voice; put who does it first ('the job sends it', not 'it is sent by the job')`,
      });
    }
    if (!names) return issues;
    const unknown: string[] = [];
    for (const m of value.matchAll(CODE_NAME_RE)) {
      const name = (m[1] ?? m[2] ?? "").trim();
      const bare = name.endsWith("()") ? name.slice(0, -2) : name;
      // Check.desc or Form.is_valid: each part must exist, not the whole (it is rarely written that way).
      const parts = /^[\w.:]+$/.test(bare) ? bare.split(/::|\./).filter(Boolean) : [bare];
      if (bare && !this.productNames.has(bare) && !unknown.includes(bare) && !parts.every((p) => this.known(p))) {
        unknown.push(bare);
      }
    }
    if (unknown.length) {
      issues.push({
        code: "unknown-code-name",
        message: `${unknown.join(", ")} not found in the change; write code names exactly as in the code, or in plain words`,
      });
    }
    return issues;
  }

  /**
   * A code name is known when the change mentions it, or failing that, when the repository has it at the head of the
   * change: the head commit, or the working tree when the change includes uncommitted work. Never the checkout
   * alone, which may be another branch than the PR.
   */
  known(name: string): boolean {
    if (this.names().includes(name)) return true;
    let hit = this.grepCache.get(name);
    if (hit === undefined) {
      const rev = this.headRev();
      hit = Boolean(
        this.root && git(["grep", "-l", "-F", "-e", name, ...(rev ? [rev] : [])], this.root, { check: false }).trim(),
      );
      this.grepCache.set(name, hit);
    }
    return hit;
  }

  /** The revision code names are read at; null: the working tree. */
  private headRev(): string | null {
    const s = this.facts.source;
    return s.includeUncommitted || !s.headSha ? null : s.headSha;
  }

  /** Everything a code name in the prose may come from, built on first use. */
  private names(): string {
    if (this.corpus === null) {
      const f = this.facts;
      const parts: string[] = [];
      for (const file of f.files) {
        parts.push(file.path, file.previousPath ?? "", ...file.hunks.flatMap((h) => h.lines.map(([, l]) => l)));
      }
      parts.push(...this.headFiles().map((text) => text.slice(0, 200_000)));
      parts.push(...f.symbols.map((s) => s.name));
      parts.push(...f.config.components.flatMap((c) => [c.id, c.name, c.desc]));
      parts.push(...f.config.layers.flatMap((l) => [l.id, l.name]));
      parts.push(...f.config.glossary.map((g) => g.term));
      parts.push(...specRequirements(f).flatMap((r) => [r.id, r.name, r.text]));
      parts.push(f.source.title, f.source.description);
      this.corpus = parts.join("\n");
    }
    return this.corpus;
  }

  /** The text of the changed files at the head of the change (unreadable ones left out: the hunks remain). */
  private headFiles(): string[] {
    if (!this.root) return [];
    const paths = this.facts.files.filter((x) => x.delta !== "removed").map((x) => x.path);
    const rev = this.headRev();
    if (rev) {
      try {
        return [...readBlobs(this.root, rev, paths).values()].filter((t): t is string => t !== null);
      } catch {
        return [];
      }
    }
    const out: string[] = [];
    for (const path of paths) {
      try {
        out.push(readFileSync(join(this.root, path), "utf8"));
      } catch {
        // unreadable: the hunks are still there
      }
    }
    return out;
  }
}
