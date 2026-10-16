import { escapeRegExp } from "./text.ts";

/**
 * Path globs as the config writes them: `*` and `?` stay inside one folder, `**` crosses folders, and a pattern
 * without wildcards also matches everything below it (`app/models` = `app/models/**`).
 */
const cache = new Map<string, RegExp>();

export function globRegExp(pattern: string): RegExp {
  const hit = cache.get(pattern);
  if (hit) return hit;
  const trimmed = pattern.trim();
  const p = trimmed === "." || trimmed === "./" ? "" : trimmed.replace(/^(?:\.\/)+/, "").replace(/^\/+|\/+$/g, "");
  let source: string;
  if (!/[*?[]/.test(p)) {
    source = p ? `^${escapeRegExp(p)}(?:/.*)?$` : "^.*$";
  } else {
    let out = "";
    let i = 0;
    while (i < p.length) {
      if (p.startsWith("**/", i)) {
        out += "(?:.*/)?";
        i += 3;
      } else if (p.startsWith("/**", i) && i + 3 === p.length) {
        out += "(?:/.*)?";
        i += 3;
      } else if (p.startsWith("**", i)) {
        out += ".*";
        i += 2;
      } else if (p[i] === "*") {
        out += "[^/]*";
        i += 1;
      } else if (p[i] === "?") {
        out += "[^/]";
        i += 1;
      } else {
        out += escapeRegExp(p[i] as string);
        i += 1;
      }
    }
    source = `^${out}$`;
  }
  const rx = new RegExp(source, "s");
  cache.set(pattern, rx);
  return rx;
}

export function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => globRegExp(p).test(path));
}

/** The literal part of a glob before its first wildcard: longer means more specific. */
export function literalPrefix(pattern: string): string {
  return pattern.split(/[*?[]/, 1)[0] as string;
}

/**
 * Python's fnmatch.fnmatchcase, for `imports`, `namespaces` and `constants`: `*` matches anything, `.` and `::`
 * included, so `billing.*` covers `billing.models.invoice`.
 */
const fnCache = new Map<string, RegExp>();

export function fnmatch(name: string, pattern: string): boolean {
  let rx = fnCache.get(pattern);
  if (!rx) {
    let out = "";
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i] as string;
      if (c === "*") out += ".*";
      else if (c === "?") out += ".";
      else if (c === "[") {
        const end = pattern.indexOf("]", i + 2);
        if (end < 0) {
          out += "\\[";
          continue;
        }
        let body = pattern.slice(i + 1, end).replace(/\\/g, "\\\\");
        if (body.startsWith("!")) body = `^${body.slice(1)}`;
        else if (body.startsWith("^")) body = `\\${body}`;
        out += `[${body}]`;
        i = end;
      } else out += escapeRegExp(c);
    }
    rx = new RegExp(`^${out}$`, "s");
    fnCache.set(pattern, rx);
  }
  return rx.test(name);
}
