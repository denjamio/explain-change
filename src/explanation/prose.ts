import type { ReportLang } from "../contract/config.ts";
import { escapeRegExp } from "../core/text.ts";
import en from "./prose/en.json" with { type: "json" };
import es from "./prose/es.json" with { type: "json" };

/*
 * Prose: the parts of ASD-STE100 (Simplified Technical English) that help a design document, not its restricted
 * dictionary: technical names are the content and stay exactly as in the code. Enforced: sentence length, the
 * refused words (by language and by why, so each error says what to write instead) and code names that exist in
 * the change. The rest is guidance the digest prints.
 */

export const MAX_SENTENCE_WORDS = 25;

export interface RefusedGroup {
  why: string;
  words: string[];
}

export const REFUSED: Record<ReportLang, RefusedGroup[]> = { en: en.refused, es: es.refused };

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

/** One regex per refused group, matching whole words. */
export function refusedPatterns(lang: ReportLang): [string, RegExp][] {
  return REFUSED[lang].map((g) => [
    g.why,
    new RegExp(`(?<![${LETTER}])(?:${g.words.map(escapeRegExp).join("|")})(?![${LETTER}])`, "gu"),
  ]);
}

/** 'seamless, seamlessly, robust' → 'seamless*, robust': a word that extends another one is folded into it. */
export function compactWords(words: string[]): string {
  return words
    .filter((w) => !words.some((o) => w !== o && w.startsWith(o)))
    .map((w) => w + (words.some((o) => o !== w && o.startsWith(w)) ? "*" : ""))
    .join(", ");
}

/** The prose rules for the digest, with every word the validator refuses in that language (w* = w and its forms). */
export function proseRules(lang: ReportLang): string {
  const refused = REFUSED[lang].map((g) => `${g.why.split(";")[0]}: ${compactWords(g.words)}`).join("; ");
  return (
    `Simplified Technical English (ASD-STE100): one idea per sentence, at most ${MAX_SENTENCE_WORDS} words; ` +
    "active voice, present tense; the effect, not how good it is; simple verbs (adds, sends, stores, calls, checks, " +
    "replaces); one word per thing; numbers as digits; no idioms. Code names (snake_case, CamelCase, Module::Name, " +
    `obj.method()) exactly as in the code. Refused: ${refused}.`
  );
}
