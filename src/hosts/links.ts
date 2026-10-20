import type { HostId } from "../contract/config.ts";
import { sha256Hex } from "../core/sha256.ts";

/*
 * Links into a PR page. Pure: the report script bundles this module, so the page builds the same links offline.
 */

/** Lines of a changed file on one side of the diff: "new" is the head (a removed file has only "old"). */
export interface LineRange {
  side: "new" | "old";
  start: number;
  end: number;
}

/** A hunk of a changed file, as the PR page draws it: [oldStart, oldLines, newStart, newLines]. */
export type HunkSpan = [number, number, number, number];

/**
 * `start`-`end` on `side`, cut to the hunk that holds `start`: a PR page draws only its hunks, so a line outside
 * every hunk has no anchor to open at (undefined: the link opens the file).
 */
export function lineRange(
  spans: HunkSpan[],
  side: LineRange["side"],
  start: number,
  end = start,
): LineRange | undefined {
  for (const [oldStart, oldLines, newStart, newLines] of spans) {
    const first = side === "new" ? newStart : oldStart;
    const last = first + (side === "new" ? newLines : oldLines) - 1;
    if (start >= first && start <= last) return { side, start, end: Math.min(Math.max(end, start), last) };
  }
  return undefined;
}

const FILE_URL: Record<HostId, (prUrl: string, path: string, lines?: LineRange, commit?: string) => string> = {
  // The files view of an Azure DevOps PR takes no line to open at. A line opens the file at the commit of its side
  // instead, with the lines selected: the repository's file link (the one Zed, GitLens and pr-brief build). The
  // selection runs from column 1 of the first line to column 1 of the line after the last, so the last is whole.
  "azure-devops": (prUrl, path, lines, commit) => {
    if (!lines || !commit) return `${prUrl}?_a=files&path=${encodeURIComponent(`/${path}`)}`;
    const repo = prUrl.replace(/\/pullrequest\/\d+\/?$/i, "");
    return (
      `${repo}?path=${encodeURIComponent(`/${path}`)}&version=GC${commit}` +
      `&line=${lines.start}&lineEnd=${lines.end + 1}&lineStartColumn=1&lineEndColumn=1&lineStyle=plain&_a=contents`
    );
  },
  // GitHub anchors each file of a PR's diff with the SHA-256 of its path, and each line of it with R (head) or
  // L (base) and its number: #diff-<sha>R12-R20 selects lines 12 to 20 of the head.
  github: (prUrl, path, lines) => {
    const file = `${prUrl}/files#diff-${sha256Hex(path)}`;
    if (!lines) return file;
    const s = lines.side === "new" ? "R" : "L";
    return `${file}${s}${lines.start}${lines.end > lines.start ? `-${s}${lines.end}` : ""}`;
  },
};

/**
 * The link to one changed file on the PR page, at `lines` when the host links to a line. `commit` is the commit of
 * the lines' side (the head, or the merge base for "old"): Azure DevOps opens a line at it, outside the PR.
 */
export const prFileUrl = (host: HostId, prUrl: string, path: string, lines?: LineRange, commit?: string) =>
  FILE_URL[host](prUrl, path, lines, commit);
