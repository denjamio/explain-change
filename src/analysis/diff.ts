import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiffLine, Hunk } from "../contract/facts.ts";
import { MAX_FILE_BYTES } from "../core/constants.ts";
import { UserError } from "../core/errors.ts";
import { git, gitPaths } from "../core/git.ts";
import { splitLines } from "../core/text.ts";

/** A file of `git diff`, before the analysis assigns its component and category. */
export interface DiffFile {
  path: string;
  previousPath: string | null;
  status: "A" | "M" | "D" | "R";
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: Hunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;
const QUOTED = String.raw`"(?:[^"\\]|\\.)*"`;
const HEADER_RE = new RegExp(`^(${QUOTED}|.+?) (${QUOTED}|b/.*)$`);
const C_ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };
const utf8 = new TextDecoder("utf-8");
const encoder = new TextEncoder();

/**
 * A path as git prints it in a diff header: C-quoted with octal UTF-8 bytes when it has special characters (quotes,
 * backslashes, control characters), and followed by a TAB on ---/+++ lines when it has spaces.
 */
export function diffPath(text: string): string {
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) return text.replace(/\t+$/, "");
  const body = text.slice(1, -1);
  const out: number[] = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] === "\\" && i + 1 < body.length) {
      const octal = /^[0-7]{3}/.exec(body.slice(i + 1, i + 4));
      if (octal) {
        out.push(Number.parseInt(octal[0], 8));
        i += 4;
      } else {
        const c = body[i + 1] as string;
        out.push(C_ESCAPES[c] ?? c.charCodeAt(0));
        i += 2;
      }
    } else {
      const cp = body.codePointAt(i) as number;
      const ch = String.fromCodePoint(cp);
      out.push(...encoder.encode(ch));
      i += ch.length;
    }
  }
  return utf8.decode(new Uint8Array(out));
}

const stripPrefix = (path: string, prefix: string) => (path.startsWith(prefix) ? path.slice(prefix.length) : path);

/**
 * (old, new) from 'diff --git a/x b/y'. Unquoted paths with spaces are ambiguous: equal halves win, else the first
 * ' b/'. The ---/+++ and rename lines, when present, override these.
 */
function headerPaths(rest: string): [string, string] {
  const half = (rest.length - 1) >> 1;
  let a = "";
  let b = "";
  if (rest.length % 2 === 1 && rest[half] === " " && rest.slice(2, half) === rest.slice(half + 3)) {
    a = rest.slice(0, half);
    b = rest.slice(half + 1);
  } else {
    const m = HEADER_RE.exec(rest);
    if (m) [a, b] = [m[1] as string, m[2] as string];
  }
  return [stripPrefix(diffPath(a), "a/"), stripPrefix(diffPath(b), "b/")];
}

/** Files of a `git diff` run with DIFF_FLAGS. */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let cur: DiffFile | null = null;
  let hunk: Hunk | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (hunk && cur && (oldLeft > 0 || newLeft > 0)) {
      if (line.startsWith("\\")) continue; // "\ No newline at end of file"
      let mark = line.slice(0, 1) || " ";
      const body = line.slice(1);
      if (mark === "+") {
        newLeft--;
        cur.additions++;
      } else if (mark === "-") {
        oldLeft--;
        cur.deletions++;
      } else {
        mark = " ";
        oldLeft--;
        newLeft--;
      }
      hunk.lines.push([mark, body] as DiffLine);
      continue;
    }
    if (!line.startsWith("@@")) hunk = null;
    if (line.startsWith("diff --git ")) {
      const [oldPath, newPath] = headerPaths(line.slice("diff --git ".length));
      cur = { path: newPath, previousPath: oldPath, status: "M", binary: false, additions: 0, deletions: 0, hunks: [] };
      files.push(cur);
    } else if (!cur) {
    } else if (line.startsWith("new file mode")) cur.status = "A";
    else if (line.startsWith("deleted file mode")) cur.status = "D";
    else if (line.startsWith("rename from ")) {
      cur.previousPath = diffPath(line.slice(12));
      cur.status = "R";
    } else if (line.startsWith("rename to ")) cur.path = diffPath(line.slice(10));
    else if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) cur.binary = true;
    else if (line.startsWith("--- ") && diffPath(line.slice(4)) !== "/dev/null") {
      cur.previousPath = stripPrefix(diffPath(line.slice(4)), "a/");
    } else if (line.startsWith("+++ ") && diffPath(line.slice(4)) !== "/dev/null") {
      cur.path = stripPrefix(diffPath(line.slice(4)), "b/");
    } else if (line.startsWith("@@")) {
      const m = HUNK_RE.exec(line);
      if (!m) continue;
      const oldLines = m[2] !== undefined ? Number(m[2]) : 1;
      const newLines = m[4] !== undefined ? Number(m[4]) : 1;
      hunk = {
        oldStart: Number(m[1]),
        oldLines,
        newStart: Number(m[3]),
        newLines,
        header: (m[5] ?? "").trim(),
        lines: [],
      };
      cur.hunks.push(hunk);
      oldLeft = oldLines;
      newLeft = newLines;
    }
  }
  for (const f of files) {
    if (f.status === "D") f.path = f.previousPath || f.path;
    if (f.status === "M" && f.previousPath && f.previousPath !== f.path) f.status = "R";
    if (f.status !== "R") f.previousPath = null;
  }
  return files;
}

/** Untracked files as added files, for --include-uncommitted. */
export function untrackedAsDiff(root: string): DiffFile[] {
  const out: DiffFile[] = [];
  for (const path of gitPaths(["ls-files", "--others", "--exclude-standard"], root)) {
    let data: Uint8Array;
    try {
      data = readFileSync(join(root, path));
    } catch {
      continue;
    }
    const binary = data.subarray(0, 8000).includes(0) || data.length > MAX_FILE_BYTES;
    const lines = binary ? [] : splitLines(utf8.decode(data));
    out.push({
      path,
      previousPath: null,
      status: "A",
      binary,
      additions: lines.length,
      deletions: 0,
      hunks: binary
        ? []
        : [
            {
              oldStart: 0,
              oldLines: 0,
              newStart: 1,
              newLines: lines.length,
              header: "",
              lines: lines.map((l) => ["+", l]),
            },
          ],
    });
  }
  return out;
}

/** --base, else project.base, else the first that exists of origin/HEAD, origin/main, origin/master, main, master… */
export function resolveBase(root: string, baseArg: string | null, configBase: string): string {
  let candidates: string[];
  if (baseArg || configBase) candidates = [(baseArg || configBase) as string];
  else {
    const head = git(["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], root, { check: false }).trim();
    candidates = [
      ...(head ? [head] : []),
      "origin/main",
      "origin/master",
      "main",
      "master",
      "origin/develop",
      "develop",
    ];
  }
  for (const c of candidates) {
    if (git(["rev-parse", "--verify", "-q", `${c}^{commit}`], root, { check: false }).trim()) return c;
  }
  throw new UserError(`Could not resolve a base branch (tried: ${candidates.join(", ")}). Use --base <ref>.`);
}
