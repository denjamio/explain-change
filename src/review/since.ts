import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Facts, FileFacts } from "../contract/facts.ts";
import { FILES } from "../core/constants.ts";
import { ensureDir } from "../core/fs.ts";
import { sha256Hex } from "../core/sha256.ts";

/*
 * What changed in a PR since you last reviewed it. A review is the PR as a valid report showed it: one snapshot
 * per head, kept in .explain-change/reviews/. The PR is compared with itself (an interdiff): a file whose own
 * patch is the same counts as unchanged, even when the PR was rebased or merged its target since.
 */

/** Of a file or a component of the PR now, against your last review of it. */
export type SinceStatus = "new" | "again" | "same";

export interface ReviewSnapshot {
  head: string;
  mergeBase: string;
  /** The date of the head commit. */
  date: string;
  /**
   * Each file of the PR: the hash of its patch, its component, and the lines it adds and removes (up to
   * MAX_PATCH_LINES; absent above), so the next head can show what changed in it since.
   */
  files: Record<string, { patch: string; component: string | null; lines?: string[] }>;
}

/** The delta the report shows: against the latest review of another head of the same PR. */
export interface Since {
  head: string;
  date: string;
  /** The PR's merge base moved: rebased, or merged its target. Its own patches are compared, not the commits. */
  rebased: boolean;
  files: Record<string, SinceStatus>;
  components: Record<string, SinceStatus>;
  /** Files in the PR at your review that it no longer changes. */
  gone: string[];
}

const KEEP = 20;
/** A file's patch lines kept in a review: above it, the next head says it changed, not how. */
const MAX_PATCH_LINES = 300;

/** The lines a file's patch adds (+) and removes (-), in order, without their numbers. */
export const patchLines = (f: FileFacts) =>
  f.hunks.flatMap((h) => h.lines.filter(([m]) => m !== " ").map(([m, t]) => `${m}${t}`));

/**
 * A file's patch without its line numbers: the lines it adds and removes, in order, with its kind and old path.
 * Lines that move because the target changed above them keep the hash. A file whose hunks the diff left out
 * (binary, generated, too large) is told apart by its counts only.
 */
export function patchHash(f: FileFacts): string {
  return sha256Hex([f.delta, f.previousPath ?? "", f.additions, f.deletions, ...patchLines(f)].join("\n")).slice(0, 16);
}

export function snapshot(facts: Facts): ReviewSnapshot {
  const files: ReviewSnapshot["files"] = {};
  for (const f of facts.files) {
    const lines = patchLines(f);
    files[f.path] = {
      patch: patchHash(f),
      component: f.component,
      ...(lines.length <= MAX_PATCH_LINES ? { lines } : {}),
    };
  }
  return { head: facts.source.headSha, mergeBase: facts.source.mergeBase, date: facts.source.headDate, files };
}

/** The PR now (`facts`) against a review of it. */
export function since(review: ReviewSnapshot, facts: Facts): Since {
  const now = snapshot(facts);
  const files: Since["files"] = {};
  for (const [path, f] of Object.entries(now.files)) {
    const before = review.files[path];
    files[path] = !before ? "new" : before.patch === f.patch ? "same" : "again";
  }
  const gone = Object.keys(review.files)
    .filter((p) => !now.files[p])
    .sort();
  const before = new Set(Object.values(review.files).map((f) => f.component));
  const components: Since["components"] = {};
  for (const c of facts.components) {
    if (c.delta === "unchanged") continue;
    const moved =
      facts.files.some((f) => f.component === c.id && files[f.path] !== "same") ||
      gone.some((p) => review.files[p]?.component === c.id);
    components[c.id] = !before.has(c.id) ? "new" : moved ? "again" : "same";
  }
  return { head: review.head, date: review.date, rebased: review.mergeBase !== now.mergeBase, files, components, gone };
}

/** One file per PR: its reviews, latest last. */
const reviewsPath = (work: string, facts: Facts) =>
  join(work, FILES.reviews, `${sha256Hex(`${facts.source.host}:${facts.source.url}`).slice(0, 16)}.json`);

function readReviews(path: string): ReviewSnapshot[] {
  if (!existsSync(path)) return [];
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(value?.reviews) ? value.reviews : [];
  } catch {
    return [];
  }
}

/** The latest review of another head of this PR, or null: not a PR, or no other head reviewed yet. */
export function lastReview(work: string, facts: Facts): ReviewSnapshot | null {
  if (facts.source.kind !== "pr" || !facts.source.url) return null;
  const reviews = readReviews(reviewsPath(work, facts)).filter((r) => r.head !== facts.source.headSha);
  return reviews[reviews.length - 1] ?? null;
}

/**
 * Keeps this head of the PR as a review: a valid report is one you read. Recording the same head again keeps the
 * review before it as the one to compare with.
 */
export function recordReview(work: string, facts: Facts): void {
  if (facts.source.kind !== "pr" || !facts.source.url) return;
  const path = reviewsPath(work, facts);
  const reviews = readReviews(path).filter((r) => r.head !== facts.source.headSha);
  ensureDir(join(work, FILES.reviews));
  const kept = [...reviews, snapshot(facts)].slice(-KEEP);
  writeFileSync(path, `${JSON.stringify({ url: facts.source.url, reviews: kept })}\n`, "utf8");
}

/**
 * What a file's patch gained (">") and lost ("<") since the review: the lines of the old and new patch that are not
 * in their longest common sequence, in order. Null when the review kept no lines of it.
 */
export function interdiff(before: string[] | undefined, now: string[]): string[] | null {
  if (!before) return null;
  const n = before.length;
  const m = now.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] = before[i] === now[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === now[j]) {
      i++;
      j++;
    } else if (i < n && (j === m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) out.push(`< ${before[i++]}`);
    else out.push(`> ${now[j++]}`); // as git: what goes, then what comes
  }
  return out;
}
