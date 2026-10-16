import type { Hunk, SymbolFacts } from "../contract/facts.ts";
import { type Lang, langOf } from "../core/lang.ts";

/** Declarations of each language: [fixed kind, or null when the regex captures it as `k`; regex capturing the name as `n`]. */
export const SYMBOL_RES: Partial<Record<Lang, [string | null, RegExp][]>> = {
  ts: [
    [
      null,
      /^\s*export\s+(?:default\s+)?(?:abstract\s+|declare\s+)?(?<k>class|interface|function|const|type|enum)\s+(?<n>[A-Za-z_$][\w$]*)/,
    ],
  ],
  py: [
    [null, /^(?:async\s+)?(?<k>class|def)\s+(?<n>[A-Za-z]\w*)/],
    ["method", /^\s{4}(?:async\s+)?def\s+(?<n>[a-zA-Z]\w*)/],
  ],
  rb: [
    [null, /^\s*(?<k>class|module)\s+(?<n>[A-Z][\w:]*)/],
    ["def", /^\s*def\s+(?<n>(?:self\.)?[a-z_]\w*[?!=]?)/],
  ],
  cs: [
    [
      null,
      /^\s*public\s+(?:(?:static|sealed|abstract|partial|readonly|ref)\s+)*(?<k>class|interface|record|struct|enum)\s+(?<n>\w+)/,
    ],
    [
      "method",
      /^\s*public\s+(?:(?:static|async|override|virtual|abstract|sealed|new|extern)\s+)*(?!class\b|interface\b|record\b|struct\b|enum\b)[\w.?[\],]+(?:<[^>]*>)?\??\s+(?<n>\w+)\s*[(<]/,
    ],
  ],
};

const RAILS_ROUTES = /(?:^|\/)config\/routes(?:\.rb|\/.+\.rb)$/;
const PY_ROUTES = /(?:^|\/)(?:urls|routers?|routes|routing)(?:\.py|\/.+\.py)$/;
/**
 * Endpoint patterns, each limited to the files where it declares a route: elsewhere `get url` or `delete user` is a
 * plain method call. Rails routes, Django urls and DRF routers, ASP.NET attributes, Angular routes.
 */
const ENDPOINT_RES: [(path: string) => boolean, RegExp][] = [
  [(p) => RAILS_ROUTES.test(p), /^\s*(?<k>get|post|put|patch|delete|resources|resource)\s+['":]?(?<n>[\w/:{}.-]+)/],
  [(p) => PY_ROUTES.test(p), /\b(?<k>re_path|path)\(\s*r?['"](?<n>[^'"]*)['"]/],
  [(p) => PY_ROUTES.test(p), /\b(?<k>register)\(\s*r?['"](?<n>[^'"]+)['"]\s*,/],
  [(p) => langOf(p) === "cs", /\[(?<k>Http(?:Get|Post|Put|Patch|Delete)|Route)(?:\(\s*"(?<n>[^"]*)"[^)]*\))?\]/],
  [
    (p) => langOf(p) === "ts",
    /\b(?<k>path)\s*:\s*['"](?<n>[^'"]*)['"]\s*,\s*(?:component|loadComponent|loadChildren|children|redirectTo)/,
  ],
];

/** The declaration a line opens: [kind, name], or null. Private names (leading `_`) are not public symbols. */
export function declarationOf(lang: Lang | null, line: string): [string, string] | null {
  for (const [kind, rx] of lang ? (SYMBOL_RES[lang] ?? []) : []) {
    const m = rx.exec(line);
    if (m?.groups) return [kind ?? (m.groups.k as string), m.groups.n as string];
  }
  return null;
}

/** Public symbols and endpoints added, removed or changed on the changed lines of one file. */
export function extractSymbols(file: { path: string; hunks: Hunk[] }): SymbolFacts[] {
  const lang = langOf(file.path);
  const endpoints = ENDPOINT_RES.filter(([applies]) => applies(file.path)).map(([, rx]) => rx);
  const found = new Map<
    string,
    { file: string; line: number; kind: string; name: string; added: boolean; removed: boolean }
  >();
  for (const h of file.hunks) {
    let oldLine = h.oldStart;
    let newLine = h.newStart;
    for (const [mark, body] of h.lines) {
      if (mark !== " ") {
        const hits: [string, string][] = [];
        const decl = declarationOf(lang, body);
        if (decl && !decl[1].startsWith("_")) hits.push(decl);
        for (const rx of endpoints) {
          const m = rx.exec(body);
          if (m?.groups) {
            hits.push(["endpoint", `${m.groups.k} ${m.groups.n ?? ""}`.trim()]);
            break;
          }
        }
        for (const [kind, name] of hits) {
          const key = `${kind}\0${name}`;
          const e = found.get(key) ?? {
            file: file.path,
            line: mark === "+" ? newLine : oldLine,
            kind,
            name,
            added: false,
            removed: false,
          };
          found.set(key, e);
          if (mark === "+") {
            e.added = true;
            e.line = newLine;
          } else e.removed = true;
        }
      }
      if (mark !== "-") newLine++;
      if (mark !== "+") oldLine++;
    }
  }
  return [...found.values()].map((e) => ({
    file: e.file,
    line: e.line,
    kind: e.kind,
    name: e.name,
    delta: e.added && e.removed ? "changed" : e.added ? "added" : "removed",
  }));
}
