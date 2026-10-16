import { readFileSync } from "node:fs";
import { join } from "node:path";
import { specRequirements } from "../analysis/openspec.ts";
import type { Facts } from "../contract/facts.ts";
import { git } from "../core/git.ts";
import { escapeRegExp } from "../core/text.ts";
import en from "./prose/en.json" with { type: "json" };

/*
 * Prose: the parts of ASD-STE100 (Simplified Technical English) that help a design document, not its restricted
 * dictionary: technical names are the content and stay exactly as in the code. Enforced: sentence length, the
 * refused words (grouped by why, so each issue says what to write instead) and code names that exist in the change.
 * The rest is guidance the digest prints.
 */

export const MAX_SENTENCE_WORDS = 25;

export interface RefusedGroup {
  why: string;
  /** Whole words or phrases; a trailing `*` also matches every ending (`leverag*` = leverage, leveraged…). */
  words: string[];
}

export const REFUSED: RefusedGroup[] = en.refused;

/** Common product names written in CamelCase that are not code of the change. */
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
export function proseRules(): string {
  const refused = REFUSED.map((g) => `${g.why.split(";")[0]}: ${g.words.join(", ")}`).join("; ");
  return (
    `Simplified Technical English (ASD-STE100): one idea per sentence, at most ${MAX_SENTENCE_WORDS} words; ` +
    "active voice, present tense; the effect, not how good it is; simple verbs (adds, sends, stores, calls, checks, " +
    "replaces); one word per thing; counts as digits (3 files), and 'a' for a single thing (a ZIP file, not 1 ZIP " +
    "file); no idioms. Code names (snake_case, CamelCase, Module::Name, obj.method()) exactly as in the code. " +
    `Refused (w* = w and its forms): ${refused}.`
  );
}

/** What is wrong with 1 field of prose. */
export interface ProseIssue {
  code: "sentence-too-long" | "refused-word" | "unknown-code-name";
  message: string;
}

/** Checks prose against the rules and code names against the change (then the repository). */
export class ProseChecker {
  private readonly refused = refusedPatterns();
  private corpus: string | null = null;
  private readonly grepCache = new Map<string, boolean>();

  constructor(
    private readonly facts: Facts,
    private readonly root: string | null,
  ) {}

  check(value: string, names: boolean): ProseIssue[] {
    const issues: ProseIssue[] = [];
    for (const sentence of value.split(SENTENCE_SPLIT_RE)) {
      const n = sentence.match(WORD_RE)?.length ?? 0;
      if (n > MAX_SENTENCE_WORDS) {
        issues.push({
          code: "sentence-too-long",
          message: `a sentence has ${n} words, max ${MAX_SENTENCE_WORDS}; split it`,
        });
        break;
      }
    }
    const low = value.toLowerCase();
    for (const [why, rx] of this.refused) {
      const found = [...new Set([...low.matchAll(rx)].map((m) => m[0]))].sort();
      if (found.length) issues.push({ code: "refused-word", message: `${found.join(", ")}: ${why}` });
    }
    if (!names) return issues;
    const unknown: string[] = [];
    for (const m of value.matchAll(CODE_NAME_RE)) {
      const name = (m[1] ?? m[2] ?? "").trim();
      const bare = name.endsWith("()") ? name.slice(0, -2) : name;
      // Check.desc or Form.is_valid: each part must exist, not the whole (it is rarely written that way).
      const parts = /^[\w.:]+$/.test(bare) ? bare.split(/::|\./).filter(Boolean) : [bare];
      if (bare && !PRODUCT_NAMES.has(bare) && !unknown.includes(bare) && !parts.every((p) => this.known(p))) {
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

  /** A code name is known when the change mentions it, or failing that, when the repository has it. */
  known(name: string): boolean {
    if (this.names().includes(name)) return true;
    let hit = this.grepCache.get(name);
    if (hit === undefined) {
      hit = Boolean(this.root && git(["grep", "-l", "-F", "-e", name], this.root, { check: false }).trim());
      this.grepCache.set(name, hit);
    }
    return hit;
  }

  /** Everything a code name in the prose may come from, built on first use. */
  private names(): string {
    if (this.corpus === null) {
      const f = this.facts;
      const parts: string[] = [];
      for (const file of f.files) {
        parts.push(file.path, file.previousPath ?? "", ...file.hunks.flatMap((h) => h.lines.map(([, l]) => l)));
        if (this.root && file.delta !== "removed") {
          try {
            parts.push(readFileSync(join(this.root, file.path), "utf8").slice(0, 200_000));
          } catch {
            // unreadable: the hunks are still there
          }
        }
      }
      parts.push(...f.symbols.map((s) => s.name));
      parts.push(...f.config.components.flatMap((c) => [c.id, c.name, c.desc]));
      parts.push(...f.config.layers.flatMap((l) => [l.id, l.name]));
      parts.push(...specRequirements(f).flatMap((r) => [r.id, r.name, r.text]));
      parts.push(f.source.title, f.source.description);
      this.corpus = parts.join("\n");
    }
    return this.corpus;
  }
}
