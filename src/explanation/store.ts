import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Explanation, NormalizedExplanation } from "../contract/explanation.ts";
import type { Facts } from "../contract/facts.ts";
import { FILES } from "../core/constants.ts";
import { draftExplanation } from "./draft.ts";
import { normalizeExplanation } from "./normalize.ts";
import { type Issue, validateExplanation } from "./validate.ts";

/**
 * explanation.json is the agent's working file for the current change. Every explanation is also kept per change in
 * explanations/<key>.json, so going back to a change already explained costs nothing, and switching changes never
 * loses work.
 *
 *   missing  no explanation.json
 *   stale    explanation.json belongs to another change (its key differs)
 *   draft    placeholders left to fill
 *   invalid  filled, with issues to fix
 *   valid    ready: the report shows it
 */
export type ExplanationState = "missing" | "stale" | "draft" | "invalid" | "valid";

export interface ExplanationStatus {
  state: ExplanationState;
  issues: Issue[];
  explanation: NormalizedExplanation | null;
}

export const explanationPath = (work: string) => join(work, FILES.explanation);
const savedPath = (work: string, key: string) => join(work, FILES.saved, `${key}.json`);

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
}

type Current = { kind: "none" } | { kind: "unreadable" } | { kind: "json"; key: string | null };

function readCurrent(path: string): Current {
  if (!existsSync(path)) return { kind: "none" };
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return { kind: "json", key: typeof value?.key === "string" ? value.key : null };
  } catch {
    return { kind: "unreadable" };
  }
}

/**
 * Makes explanation.json belong to this change: keeps it when it already does (or when it is mid-write), brings
 * back the one kept for this change, or writes a fresh draft. One for another change is kept under its own key
 * first, so no work is lost.
 */
export function prepareExplanation(work: string, facts: Facts): "kept" | "restored" | "drafted" {
  const path = explanationPath(work);
  const current = readCurrent(path);
  if (current.kind === "unreadable" || (current.kind === "json" && current.key === facts.key)) return "kept";
  mkdirSync(join(work, FILES.saved), { recursive: true });
  if (current.kind === "json" && current.key && !existsSync(savedPath(work, current.key))) {
    copyFileSync(path, savedPath(work, current.key));
  }
  if (existsSync(savedPath(work, facts.key))) {
    copyFileSync(savedPath(work, facts.key), path);
    return "restored";
  }
  writeJson(path, draftExplanation(facts));
  return "drafted";
}

/** The state of explanation.json for this change. A valid one is also kept under the change's key. */
export function loadExplanation(work: string, facts: Facts, root: string | null): ExplanationStatus {
  const path = explanationPath(work);
  if (!existsSync(path)) return { state: "missing", issues: [], explanation: null };
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return {
      state: "invalid",
      issues: [{ path: "explanation.json", code: "invalid-json", message: `not valid JSON: ${(e as Error).message}` }],
      explanation: null,
    };
  }
  const key = (value as { key?: unknown } | null)?.key;
  if (key !== facts.key) {
    return {
      state: "stale",
      issues: [{ path: "key", code: "stale", message: `'${String(key)}' is not this change's key '${facts.key}'` }],
      explanation: null,
    };
  }
  const issues = validateExplanation(value, facts, root);
  if (issues.some((i) => i.code === "placeholder")) return { state: "draft", issues, explanation: null };
  if (issues.length) return { state: "invalid", issues, explanation: null };
  mkdirSync(join(work, FILES.saved), { recursive: true });
  writeJson(savedPath(work, facts.key), value);
  return { state: "valid", issues: [], explanation: normalizeExplanation(value as Explanation, facts) };
}
