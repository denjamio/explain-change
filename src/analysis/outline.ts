import { LIMITS } from "../contract/explanation.ts";
import type { DetectedFlow, Facts, FileFacts, Hunk, Outline } from "../contract/facts.ts";
import { LOCATION_RE } from "../contract/facts.ts";
import { langOf } from "../core/lang.ts";
import { basename } from "../core/paths.ts";
import { byKeys, escapeRegExp } from "../core/text.ts";
import { mappableRequirements } from "./openspec.ts";
import { declarationOf } from "./symbols.ts";

/** Facts before the outline is added: what the outline is computed from. */
export type FactsCore = Omit<Facts, "outline">;

/** Where the data model lives: models/, schemas/, entities/ or db/ folders, and Django's models.py. */
const DATA_PATH_RE = /(^|\/)(models?|schemas?|entities|db)\/|(^|\/)models\.py$/;

/** Files that change the data model: migrations first, then models and schemas. */
export function dataFiles(facts: Pick<FactsCore, "files">): FileFacts[] {
  const fs = facts.files.filter((f) => f.hunks.length && f.category !== "test");
  return [
    ...fs.filter((f) => f.category === "migration"),
    ...fs.filter((f) => f.category === "code" && DATA_PATH_RE.test(f.path)),
  ];
}

/** file:first-last of a hunk, on the side the report shows (the old side for a removed file). */
export function hunkRef(f: FileFacts, h: Hunk): string {
  const [start, len] = f.delta === "removed" ? [h.oldStart, h.oldLines] : [h.newStart, h.newLines];
  return `${f.path}:${start}-${start + Math.max(len, 1) - 1}`;
}

/** The file of a "file:line" location. */
export const locationFile = (loc: string) => LOCATION_RE.exec(loc)?.[1] ?? loc;

/** What makes a hunk worth reading: the context the scores need. */
export interface HunkContext {
  symbolLines: Set<string>; // "file\0line"
  crossFiles: Set<string>; // files whose references create, remove or break a dependency
  crossLines: Set<string>; // "file\0line" of those references
}

export function hunkContext(facts: Pick<FactsCore, "symbols" | "dependencies">): HunkContext {
  const examples = facts.dependencies
    .filter((e) => e.delta !== "unchanged" || e.violation)
    .flatMap((e) => e.examples)
    .map((loc) => LOCATION_RE.exec(loc))
    .filter((m): m is RegExpExecArray => Boolean(m));
  return {
    symbolLines: new Set(facts.symbols.map((s) => `${s.file}\0${s.line}`)),
    crossFiles: new Set(examples.map((m) => m[1] as string)),
    crossLines: new Set(examples.map((m) => `${m[1]}\0${m[2]}`)),
  };
}

/**
 * Files a framework asks for that only register or re-export what other files declare: their public symbols say
 * nothing about the change (Django's AppConfig in apps.py, a package's __init__.py, .NET's assembly attributes).
 */
const WIRING_FILES = new Set(["apps.py", "__init__.py", "AssemblyInfo.cs", "GlobalUsings.cs"]);

/** An import, require or using line: the digest already lists the dependency it creates. */
const IMPORT_LINE_RE = /^\s*(?:import|from\s+\S+\s+import|require(?:_relative)?|using|export\s+.*\bfrom)\b/;

/** The names an import line brings in: a, b and c from `from m import a, b as c` or `import { a, b as c } from "m"`. */
function importedNames(line: string): string[] {
  const m = /^\s*(?:from\s+\S+\s+import|import|export)\s+(.*?)(?:\s+from\s.*)?;?\s*$/.exec(line);
  return (m?.[1] ?? "").match(/[A-Za-z_$][\w$]*/g)?.filter((w) => !IMPORT_WORDS.has(w)) ?? [];
}
const IMPORT_WORDS = new Set(["as", "type", "typeof", "from", "import", "export"]);

/** The names the change's added import lines bring into a file: a hunk that uses one holds the new dependency. */
function addedImports(f: FileFacts): RegExp | null {
  const names = new Set(
    f.hunks.flatMap((h) =>
      h.lines
        .filter(([mark, body]) => mark === "+" && IMPORT_LINE_RE.test(body))
        .flatMap(([, body]) => importedNames(body)),
    ),
  );
  return names.size ? new RegExp(`(?<![\\w$])(?:${[...names].map(escapeRegExp).join("|")})(?![\\w$])`) : null;
}

/** Whether every changed line of a hunk is an import or blank: the dependency without the code that uses it. */
const importsOnly = (h: Hunk) => {
  const changed = h.lines.filter(([mark, body]) => mark !== " " && body.trim());
  return changed.length > 0 && changed.every(([, body]) => IMPORT_LINE_RE.test(body));
};

/**
 * 0 = never shown. Code in a component beats config and migrations, which beat unmapped code; public symbols and
 * dependency changes add to it, most for the hunk that holds the reference (or uses a name the change imports). A
 * hunk of imports only, or of a file a framework asks for (WIRING_FILES), shows the least: what it says is already in
 * the digest's dependencies.
 */
export function hunkScore(f: FileFacts, h: Hunk, ctx: HunkContext): number {
  if (f.category === "test" || f.category === "docs" || f.category === "ignored") return 0;
  if (WIRING_FILES.has(basename(f.path)) || importsOnly(h)) return 1;
  let score = f.category === "code" ? (f.component ? 3 : 1) : 2;
  let symbol = false;
  let reference = false;
  for (let n = h.newStart; n < h.newStart + Math.max(h.newLines, 1); n++) {
    symbol ||= ctx.symbolLines.has(`${f.path}\0${n}`);
    reference ||= ctx.crossLines.has(`${f.path}\0${n}`);
  }
  if (symbol) score += 3;
  if (!reference && ctx.crossFiles.has(f.path)) {
    const uses = addedImports(f);
    reference = Boolean(
      uses && h.lines.some(([mark, body]) => mark === "+" && !IMPORT_LINE_RE.test(body) && uses.test(body)),
    );
  }
  if (reference) score += 2;
  else if (ctx.crossFiles.has(f.path)) score += 1;
  return score;
}

/** The highest-ranked hunk among these files, as file:first-last. */
function bestHunk(files: FileFacts[], ctx: HunkContext): string | null {
  const scored = files
    .flatMap((f) => f.hunks.map((h, i) => ({ f, h, i, score: hunkScore(f, h, ctx) })))
    .sort(byKeys((x) => [-x.score, x.f.path, x.i]));
  const top = scored[0];
  return top && top.score > 0 ? hunkRef(top.f, top.h) : null;
}

/**
 * Drawn dependencies the change creates or grows, the candidates for keyDependencies, best first: links between 2
 * components the change touches (its own path) before links into a neighbor, new before grown, then the strongest.
 * A link into the bottom lane (the shared kernel or the platform, which every change touches) comes last when it is
 * new, and is no candidate when it only grows: it says little about this change.
 */
export function keyDependencyCandidates(
  facts: Pick<FactsCore, "dependencies" | "components"> & {
    config: Pick<FactsCore["config"], "layers" | "components">;
  },
) {
  // With 3 lanes or more, the bottom one holds what every lane uses; with 2, it is the domain itself.
  const bottom = facts.config.layers.length >= 3 ? facts.config.layers.at(-1)?.id : undefined;
  const layerOf = new Map(facts.config.components.map((c) => [c.id, c.layer]));
  const intoBottom = (to: string) => Boolean(bottom) && layerOf.get(to) === bottom;
  const touched = new Set(facts.components.filter((c) => c.delta !== "unchanged").map((c) => c.id));
  return facts.dependencies
    .filter((e) => e.delta === "added" || (e.delta === "changed" && e.headCount > e.baseCount && !intoBottom(e.to)))
    .sort(
      byKeys((e) => [
        intoBottom(e.to) ? 1 : 0,
        touched.has(e.from) && touched.has(e.to) ? 0 : 1,
        e.delta === "added" ? 0 : 1,
        -(e.headCount - e.baseCount),
        e.from,
        e.to,
      ]),
    );
}

/**
 * How much a changed component matters to the story: the public symbols it changes, the dependencies it gains or
 * loses, whether it migrates its data model (a new field is no symbol, but it is what the change is about), then
 * its lines of code. Config and generated lines do not count: an OpenAPI spec or a generated client is big, and
 * rarely the point.
 */
function storyWeight(facts: FactsCore, id: string): [number, number] {
  const fileComponent = new Map(facts.files.map((f) => [f.path, f.component]));
  const symbols = facts.symbols.filter((s) => fileComponent.get(s.file) === id).length;
  const deps = facts.dependencies.filter(
    (e) => (e.from === id || e.to === id) && (e.delta === "added" || e.delta === "removed"),
  ).length;
  // Migrations only: a models/ folder is no proof (a mobile client keeps its view models in one).
  const model = facts.files.some((f) => f.component === id && f.category === "migration" && f.hunks.length) ? 2 : 0;
  const code = facts.files
    .filter((f) => f.component === id && f.category === "code")
    .reduce((n, f) => n + f.additions + f.deletions, 0);
  return [symbols * 3 + deps * 2 + model, code];
}

/** A component that rewrites at least this many lines, and this share of the change's code, earns a story step. */
const REWRITE_MIN_LINES = 50;
const REWRITE_SHARE = 0.3;
/** The share of the code the change rewrites that the draft's story lights, when the budget lets it. */
const COVERAGE_MIN = 0.8;

/**
 * How many steps the draft's story has, the overview included, from the lines of code the change rewrites: a small
 * change reads in 4 steps, a medium one in 6, a large one in up to LIMITS.story. The agent deletes a step that says
 * nothing new, but a draft that is already the right size costs no tokens to trim.
 */
export function storyBudget(churn: number): number {
  if (churn < SMALL_CHANGE_LINES) return 4;
  if (churn < MEDIUM_CHANGE_LINES) return 6;
  return LIMITS.story;
}
const SMALL_CHANGE_LINES = 150;
const MEDIUM_CHANGE_LINES = 600;

/** The `n` items with the lowest priority, in their own order (a tie keeps the earlier one). */
function keepFirst<T extends { priority: number }>(items: T[], n: number): T[] {
  const kept = new Set(
    items
      .map((x, i) => ({ x, i }))
      .sort(byKeys(({ x, i }) => [x.priority, i]))
      .slice(0, Math.max(0, n))
      .map(({ i }) => i),
  );
  return items.filter((_, i) => kept.has(i));
}

/**
 * Where a component's lane puts it in the story: 0 for the inner lanes, 1 for the entry lane (the top one), 2 for
 * the bottom one with 3 lanes or more (the shared kernel or the platform; with 2, the bottom lane is the domain).
 */
function laneOf(facts: Pick<FactsCore, "config">): (id: string) => number {
  const ids = facts.config.layers.map((l) => l.id);
  const index = new Map(facts.config.components.map((c) => [c.id, ids.indexOf(c.layer)]));
  return (id) => {
    const i = index.get(id) ?? -1;
    if (ids.length < 2 || i < 0) return 0;
    if (i === 0) return 1;
    return ids.length >= 3 && i === ids.length - 1 ? 2 : 0;
  };
}

/** Where a runtime path starts: a request handler, a background job or a command. First match wins. */
const ENTRY_RES: [string, RegExp][] = [
  [
    "request",
    /(?:^|\/)(?:controllers|views|api|handlers|endpoints|resolvers|graphql)\/|(?:^|\/)views\.py$|Controller\.\w+$/,
  ],
  ["job", /(?:^|\/)(?:jobs|workers|consumers|subscribers|listeners)\/|(?:^|\/)tasks\.py$/],
  ["command", /(?:^|\/)(?:management\/commands|commands|lib\/tasks|bin)\//],
];
const NOT_ENTRY_RE = /\.(?:erb|haml|slim|html?|jinja2?|j2|hbs|mustache|liquid|txt|md)$/;
const CALL_RE = /(?:::)?[A-Z]\w*(?:::[A-Z]\w*)*(?:\.[a-z_]\w*[?!]?)?|\b[a-z_]\w*\.[a-z_]\w*[?!]?(?=\()/;
const SCOPE_KINDS = new Set(["class", "module", "interface", "record", "struct"]);

/**
 * [class, method, text] around a new-side line of a changed file, read from its hunk: the declarations above it in
 * the hunk, else git's function header.
 */
export function enclosing(f: FileFacts, line: number): [string | null, string | null, string] {
  const lang = langOf(f.path);
  for (const h of f.hunks) {
    let n = h.newStart;
    let cls: string | null = null;
    let fn: string | null = null;
    for (const [mark, body] of h.lines) {
      if (mark === "-") continue;
      const decl = declarationOf(lang, body);
      if (decl) {
        if (SCOPE_KINDS.has(decl[0])) [cls, fn] = [decl[1], null];
        else fn = decl[1];
      }
      if (n === line) {
        if (!cls && !fn) fn = declarationOf(lang, h.header)?.[1] ?? null;
        return [cls, fn, body];
      }
      n++;
    }
  }
  return [null, null, ""];
}

interface Call {
  from: string;
  to: string;
  added: boolean;
  path: string;
  line: number;
}

/**
 * Runtime paths the change starts, read from the code: an entry point (request handler, job, command) whose added
 * lines call another component, then the calls onward from each component reached. Each path names its trigger and
 * its steps with the call the code makes. Same change → same paths.
 */
/** A detected flow's id from its trigger: kebab-case, at most 40 characters, cut before it is trimmed. */
export function flowId(trigger: string): string {
  return (
    trigger
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40)
      .replace(/^-+|-+$/g, "") || "flow"
  );
}

export function detectFlows(facts: Pick<FactsCore, "files" | "dependencies">): DetectedFlow[] {
  const files = new Map(facts.files.filter((f) => f.hunks.length && f.category === "code").map((f) => [f.path, f]));
  const addedLines = new Map<string, Set<number>>(); // only lines the change adds can start or carry a path
  for (const [path, f] of files) {
    for (const h of f.hunks) {
      let n = h.newStart;
      for (const [mark, body] of h.lines) {
        if (mark === "+" && !IMPORT_LINE_RE.test(body)) {
          const set = addedLines.get(path) ?? new Set<number>();
          set.add(n);
          addedLines.set(path, set);
        }
        if (mark !== "-") n++;
      }
    }
  }
  const scope = (c: Pick<Call, "path" | "line">) => enclosing(files.get(c.path) as FileFacts, c.line);
  // A class that inherits or implements (`class FamilyExport < ApplicationRecord`) depends on its parent, but
  // calls nothing at run time: it is no step of a path, and its first name is the class it declares.
  const declares = (c: Pick<Call, "path" | "line">) =>
    SCOPE_KINDS.has(declarationOf(langOf(c.path), scope(c)[2])?.[0] ?? "");
  const calls: Call[] = [];
  for (const e of facts.dependencies) {
    if (e.delta === "removed") continue;
    for (const ref of e.examples) {
      const m = LOCATION_RE.exec(ref);
      if (!m || m[3]) continue;
      const at = { path: m[1] as string, line: Number(m[2]) };
      if (addedLines.get(at.path)?.has(at.line) && !declares(at))
        calls.push({ from: e.from, to: e.to, added: e.delta === "added", ...at });
    }
  }
  calls.sort(byKeys((c) => [c.path, c.line, c.to]));
  const entryKind = (path: string) => (NOT_ENTRY_RE.test(path) ? null : ENTRY_RES.findIndex(([, rx]) => rx.test(path)));
  const kindRank = (path: string) => {
    const k = entryKind(path);
    return k === null || k < 0 ? 9 : k;
  };
  const pair = (c: Call) => `${c.from}\0${c.to}`;
  const out: DetectedFlow[] = [];
  const covered = new Set<string>();
  for (const c of [...calls].sort(byKeys((c) => [kindRank(c.path), c.path, c.line]))) {
    if (kindRank(c.path) === 9 || covered.has(pair(c)) || out.length === LIMITS.flows) continue;
    const [cls, fn] = scope(c);
    const sep = langOf(c.path) === "rb" ? "#" : ".";
    const trigger = (cls && fn ? `${cls}${sep}${fn}` : (fn ?? cls ?? (basename(c.path).split(".")[0] as string))).slice(
      0,
      LIMITS["flows.trigger"],
    );
    const sameScope = calls.filter((x) => x.path === c.path && scope(x)[0] === cls && scope(x)[1] === fn);
    const steps: DetectedFlow["steps"] = [];
    const seen = new Set<string>();
    const queue = sameScope.filter((x) => x.from === c.from);
    while (queue.length && steps.length < 6) {
      const x = queue.shift() as Call;
      if (seen.has(pair(x))) continue;
      seen.add(pair(x));
      const text = scope(x)[2].trim();
      steps.push({ from: x.from, to: x.to, call: CALL_RE.exec(text)?.[0] ?? "", delta: x.added ? "added" : "changed" });
      queue.push(...calls.filter((y) => y.from === x.to && y.to !== c.from && !seen.has(pair(y))));
    }
    for (const s of seen) covered.add(s);
    let id = flowId(trigger);
    if (out.some((fl) => fl.id === id)) id = `${id}-${out.length + 1}`;
    out.push({ id, trigger, steps });
  }
  return out;
}

/**
 * The story's skeleton from the facts: what each step is about, its view, focus and code. The agent writes the
 * words and keeps this order unless the hunks show another headline. Same change → same outline.
 */
export function outline(facts: FactsCore): Outline {
  const ctx = hunkContext(facts);
  const filesOf = new Map<string, FileFacts[]>();
  for (const f of facts.files) {
    if (f.component && f.category !== "test" && f.category !== "ignored") {
      filesOf.set(f.component, [...(filesOf.get(f.component) ?? []), f]);
    }
  }
  const touched = facts.components.filter((c) => c.delta !== "unchanged");
  // Steps name components as the team does: the draft's headings start from these words.
  const names = new Map(facts.config.components.map((c) => [c.id, c.name]));
  const name = (id: string) => names.get(id) ?? id;
  // Each step with its priority: when the change is small, the budget keeps the lowest numbers (see storyBudget).
  const story: (Outline["story"][number] & { priority: number })[] = [];
  for (const e of facts.dependencies.filter((e) => e.violation && !e.violation.preexisting).slice(0, 2)) {
    const file = locationFile(e.examples[0] ?? "");
    story.push({
      priority: 0,
      about: `${name(e.from)} now depends on ${name(e.to)} (${e.violation?.rule})`,
      view: "architecture",
      focus: [e.from, e.to],
      code: bestHunk(
        facts.files.filter((f) => f.path === file),
        ctx,
      ),
    });
  }
  // 1 ranking for added, removed and changed components: being new is worth something, not everything (a new
  // folder of locales is no headline). The lane decides first, so every change reads the same way: the story
  // opens where the behavior is decided (the inner lanes), then its entry points, then the bottom lane. Weight only
  // orders a lane. A component with no weight (no public symbol, dependency gained or lost, or migration) gets no
  // step of its own unless nothing else does, or unless it holds a large share of the code the change rewrites (a
  // refactor inside existing functions has no new symbol): its summary and the overview say it, so the story stays
  // short.
  const lane = laneOf(facts);
  const weights = touched.map((c) => ({ c, w: storyWeight(facts, c.id) }));
  const churn = weights.reduce((n, x) => n + x.w[1], 0);
  const rewrites = (code: number) => code >= REWRITE_MIN_LINES && code >= churn * REWRITE_SHARE;
  const ranked = weights
    .map(({ c, w: [weight, code] }) => ({
      c,
      weight: weight + (c.delta === "changed" ? 0 : 2) + (rewrites(code) ? 1 : 0),
      code,
    }))
    .sort(byKeys((x) => [x.weight > 0 ? lane(x.c.id) : 3, -x.weight, -x.code, x.c.id]));
  const weighted = ranked.filter((x) => x.weight > 0);
  const picked = (weighted.length ? weighted : ranked.slice(0, 1)).slice(0, Math.max(0, 4 - story.length));
  for (const [i, { c }] of picked.entries()) {
    story.push({
      priority: i === 0 ? 1 : 5 + i,
      about: `${name(c.id)} ${c.delta}`,
      view: "architecture",
      focus: [c.id],
      code: bestHunk(filesOf.get(c.id) ?? [], ctx),
    });
  }
  const flows = facts.components.length >= 2 ? detectFlows(facts) : [];
  const firstFlow = flows[0];
  // The story walks what the change is made of: while the steps so far light less than COVERAGE_MIN of the code it
  // rewrites, the largest component left in the dark (at least REWRITE_MIN_LINES of code) gets a step, ranked right after the first one, so a short
  // budget drops a small component before it.
  const lit = new Set([...picked.map((x) => x.c.id), ...(firstFlow?.steps.flatMap((s) => [s.from, s.to]) ?? [])]);
  const litCode = () => ranked.filter((x) => lit.has(x.c.id)).reduce((n, x) => n + x.code, 0);
  for (const [i, { c }] of ranked
    .filter((x) => !lit.has(x.c.id) && x.code >= REWRITE_MIN_LINES)
    .sort(byKeys((x) => [-x.code, x.c.id]))
    .entries()) {
    if (litCode() >= churn * COVERAGE_MIN) break;
    lit.add(c.id);
    story.push({
      priority: 1 + (i + 1) / 10,
      about: `${name(c.id)} ${c.delta}`,
      view: "architecture",
      focus: [c.id],
      code: bestHunk(filesOf.get(c.id) ?? [], ctx),
    });
  }
  if (firstFlow) {
    story.push({
      priority: 3,
      about: `what happens when ${firstFlow.trigger} runs`,
      view: `flow:${firstFlow.id}`,
      focus: [],
      code: null,
    });
  }
  const data = dataFiles(facts);
  if (data.length) {
    story.push({
      priority: 4,
      about: "the data model",
      view: "data",
      focus: [],
      code: bestHunk(data.slice(0, 1), ctx),
    });
  }
  const reqs = mappableRequirements(facts);
  if (reqs.length) {
    story.push({
      priority: 2,
      about: "the requirements the code meets",
      view: "requirements",
      focus: reqs.slice(0, 3).map((r) => r.id),
      code: null,
    });
  }
  return {
    story: [
      ...keepFirst(story, storyBudget(churn) - 1).map(({ priority: _, ...step }) => step),
      { about: "overview: the whole change in one step", view: "architecture", focus: [], code: null },
    ],
    flows,
    keyDependencyCandidates: keyDependencyCandidates(facts).map(({ from, to }) => ({ from, to })),
    dataFiles: data.map((f) => f.path),
  };
}
