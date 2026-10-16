import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Mapper } from "../config/mapper.ts";
import type { Config } from "../contract/config.ts";
import type {
  ComponentFacts,
  DependencyFacts,
  Facts,
  FileFacts,
  PublicConfig,
  Source,
  Stats,
  SymbolFacts,
} from "../contract/facts.ts";
import {
  ANALYSIS_VERSION,
  CONFIG_NAME,
  CONTRACT_VERSION,
  DIFF_FLAGS,
  GENERATED_HEAD,
  GENERATED_RE,
  MAX_DIFF_LINES,
  MAX_SCAN_FILES,
  VERSION,
} from "../core/constants.ts";
import { UserError } from "../core/errors.ts";
import { decodeText, git, gitPaths, gitRaw, readBlobs } from "../core/git.ts";
import { langOf } from "../core/lang.ts";
import { basename } from "../core/paths.ts";
import { byKeys, compareStrings } from "../core/text.ts";
import type { PrHost } from "../hosts/host.ts";
import { prSource } from "../hosts/source.ts";
import { type DiffFile, parseDiff, resolveBase, untrackedAsDiff } from "./diff.ts";
import { buildGraph, edgeKey, ruleViolation, type SideGraph, splitEdgeKey } from "./graph.ts";
import { collectOpenSpec } from "./openspec.ts";
import { type FactsCore, outline } from "./outline.ts";
import { portLinks } from "./ports.ts";
import { type Extracted, extractRefs } from "./refs.ts";
import { loadTsConfigs, SideIndex } from "./resolve.ts";
import { extractSymbols } from "./symbols.ts";

/** What to explain: the current branch (optionally with uncommitted work), or a PR. */
export interface ChangeRequest {
  base: string | null;
  includeUncommitted: boolean;
  /** A PR id or URL, read from `host`; null for the current branch. */
  pr: string | null;
  /** The PR's host; for a branch, the host its PR would be on (null when none). */
  host: PrHost | null;
  specs: string[];
}

export function repoRoot(cwd = process.cwd()): string {
  const out = git(["rev-parse", "--show-toplevel"], cwd, { check: false }).trim();
  if (!out) throw new UserError("Not inside a git repository.");
  return out;
}

/** The whole change as facts: source, files, components, dependencies, symbols, stats, OpenSpec and the outline. */
export function collect(root: string, config: Config, req: ChangeRequest): Facts {
  const mapper = new Mapper(config);
  const notes: string[] = [];
  const { source, mergeBase, headRev } = changeSource(root, config, req, notes);
  const { files, rawDiff, totalLines } = changedFiles(
    root,
    mapper,
    mergeBase,
    headRev,
    req.includeUncommitted && !req.pr,
  );
  if (totalLines >= MAX_DIFF_LINES)
    notes.push(`Diff larger than ${MAX_DIFF_LINES} lines: some files are listed without hunks.`);

  const baseFiles = new Set(gitPaths(["ls-tree", "-r", "--name-only", mergeBase], root));
  const headFiles = new Set(baseFiles);
  for (const f of files) if (f.status === "D" || f.status === "R") headFiles.delete(f.previousPath ?? f.path);
  for (const f of files) if (f.status !== "D") headFiles.add(f.path);
  const touched = new Set(
    files
      .filter((f) => f.component && f.category !== "test" && f.category !== "ignored")
      .map((f) => f.component as string),
  );
  const scan = scanSides(root, mapper, files, baseFiles, headFiles, touched, mergeBase, headRev, req.specs, notes);

  const symbols = files
    .filter((f) => (f.category === "code" || f.category === "config") && f.hunks.length)
    .flatMap((f) => extractSymbols(f));
  const dependencies = relevantDependencies(config, files, symbols, scan.base, scan.head, touched);
  // Only the change's own files: the rest of the repository is not what the reader is looking at.
  const unresolved = files.reduce((n, f) => n + (scan.head.unresolved.get(f.path) ?? 0), 0);
  const stats = changeStats(files, dependencies, unresolved);
  if (!config.inferred) notes.push(...coverageNotes(files, stats));
  const core: FactsCore = {
    version: CONTRACT_VERSION,
    tool: VERSION,
    analysis: ANALYSIS_VERSION,
    key: changeKey(root, rawDiff, req.specs),
    source,
    config: publicConfig(config, root),
    files: files.map(toFileFacts),
    components: componentRows(config, mapper, files, dependencies, touched, baseFiles, headFiles),
    dependencies,
    dependencyGraph: [...scan.head.edges.keys()].map(splitEdgeKey).sort(byKeys((p) => p)),
    ports: scan.ports.filter((l) => touched.has(l.from) || touched.has(l.to)),
    symbols,
    stats,
    notes,
    openspec: scan.openspec,
  };
  return { ...core, outline: outline(core) };
}

interface AnalyzedFile extends DiffFile {
  component: string | null;
  category: FileFacts["category"];
  truncated: boolean;
}

function toFileFacts(f: AnalyzedFile): FileFacts {
  return {
    path: f.path,
    previousPath: f.previousPath,
    delta: f.status === "A" ? "added" : f.status === "D" ? "removed" : "changed",
    binary: f.binary,
    additions: f.additions,
    deletions: f.deletions,
    component: f.component,
    category: f.category,
    truncated: f.truncated,
    hunks: f.hunks,
  };
}

function changeSource(
  root: string,
  config: Config,
  req: ChangeRequest,
  notes: string[],
): { source: Source; mergeBase: string; headRev: string | null } {
  let partial: Omit<Source, "headDate" | "commits">;
  let mergeBase: string;
  let headRev: string | null;
  if (req.pr) {
    if (!req.host) throw new Error("a PR needs its host");
    const pr = prSource(root, req.host, req.pr, notes);
    partial = { kind: "pr", ...pr, includeUncommitted: false };
    mergeBase = pr.mergeBase;
    headRev = pr.headSha;
  } else {
    const base = resolveBase(root, req.base, config.base);
    mergeBase = git(["merge-base", base, "HEAD"], root).trim();
    const headSha = git(["rev-parse", "HEAD"], root).trim();
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], root).trim();
    const detached = branch === "HEAD";
    // One commit says what the change is better than a branch name; the branch still shows beside the title.
    const single = git(["rev-list", "--count", `${mergeBase}..HEAD`], root).trim() === "1";
    partial = {
      kind: "local",
      title: detached || single ? git(["log", "-1", "--format=%s", "HEAD"], root).trim() : branch,
      description: "",
      branch: detached ? headSha.slice(0, 8) : branch,
      baseRef: base,
      headRef: "HEAD",
      headSha,
      mergeBase,
      host: req.host?.id ?? null,
      prId: null,
      url: null,
      includeUncommitted: req.includeUncommitted,
    };
    headRev = req.includeUncommitted ? null : headSha;
  }
  // Newer git prints UTC as "Z", older as "+00:00": one form, so the page does not depend on the git version.
  const headDate = git(["log", "-1", "--format=%cI", partial.headSha], root).trim().replace(/Z$/, "+00:00");
  const commits = Number(git(["rev-list", "--count", `${mergeBase}..${partial.headSha}`], root).trim() || 0);
  return { source: { ...partial, headDate, commits }, mergeBase, headRev };
}

/** A generator marker in the first lines of a file ("DO NOT MODIFY - generated by…", "@generated"). */
function looksGenerated(head: string | null): boolean {
  return head?.split("\n", GENERATED_HEAD).some((line) => GENERATED_RE.test(line)) ?? false;
}

/**
 * The text of each file at the head of the change, to read its first lines: a hunk in the middle of a generated
 * file does not show its marker. Uncommitted work is read from the working tree.
 */
function headTexts(root: string, headRev: string | null, paths: string[]): Map<string, string | null> {
  if (headRev) return readBlobs(root, headRev, paths);
  return new Map(
    paths.map((p) => {
      try {
        return [p, readFileSync(join(root, p), "utf8").slice(0, 4096)];
      } catch {
        return [p, null];
      }
    }),
  );
}

/** Paths marked `linguist-generated` in .gitattributes. */
function generatedPaths(root: string, paths: string[]): Set<string> {
  if (!paths.length) return new Set();
  const p = gitRaw(["check-attr", "-z", "--stdin", "linguist-generated"], root, {
    input: `${paths.join("\0")}\0`,
    check: false,
  });
  if (p.status !== 0) return new Set();
  const parts = new TextDecoder().decode(p.stdout).split("\0");
  const out = new Set<string>();
  for (let i = 0; i + 2 < parts.length; i += 3) {
    if (parts[i + 2] === "set" || parts[i + 2] === "true") out.add(parts[i] as string);
  }
  return out;
}

function changedFiles(root: string, mapper: Mapper, mergeBase: string, headRev: string | null, untracked: boolean) {
  let rawDiff = git(["diff", ...DIFF_FLAGS, mergeBase, ...(headRev ? [headRev] : [])], root);
  const parsed = parseDiff(rawDiff);
  if (untracked) {
    const extra = untrackedAsDiff(root);
    parsed.push(...extra);
    rawDiff += extra
      .map((f) => `\nuntracked ${f.path}\n${f.hunks.flatMap((h) => h.lines.map(([, l]) => l)).join("\n")}`)
      .join("");
  }
  parsed.sort((a, b) => compareStrings(a.path, b.path));
  const present = parsed.filter((f) => f.status !== "D").map((f) => f.path);
  const generated = generatedPaths(root, present);
  const heads = headTexts(root, headRev, present);
  let totalLines = 0;
  const files: AnalyzedFile[] = parsed.map((f) => {
    const category =
      generated.has(f.path) || looksGenerated(heads.get(f.path) ?? null) ? "ignored" : mapper.category(f.path);
    const component = mapper.component(f.path) ?? (f.previousPath ? mapper.component(f.previousPath) : null);
    const n = f.hunks.reduce((a, h) => a + h.lines.length, 0);
    if (totalLines + n > MAX_DIFF_LINES || category === "ignored") {
      return { ...f, component, category, truncated: f.hunks.length > 0, hunks: [] };
    }
    totalLines += n;
    return { ...f, component, category, truncated: false };
  });
  return { files, rawDiff, totalLines };
}

const SCAN_CHUNK = 500;

/** Reads the source files on both sides of the change: the dependency graph at the base and at the head, and OpenSpec. */
function scanSides(
  root: string,
  mapper: Mapper,
  files: AnalyzedFile[],
  baseFiles: Set<string>,
  headFiles: Set<string>,
  touched: Set<string>,
  mergeBase: string,
  headRev: string | null,
  specs: string[],
  notes: string[],
) {
  const changedNew = new Set(files.filter((f) => f.status !== "D").map((f) => f.path));
  const changedOld = new Set(files.filter((f) => f.status !== "A").map((f) => f.previousPath ?? f.path));
  const scannable = (p: string) => Boolean(langOf(p)) && ["code", "config"].includes(mapper.category(p));
  let baseScan = [...baseFiles].filter(scannable).sort(compareStrings);
  const partial = baseScan.length > MAX_SCAN_FILES;
  if (partial) {
    baseScan = baseScan.filter((p) => touched.has(mapper.component(p) ?? ""));
    notes.push(`Large repository: dependency scan limited to touched components (${baseScan.length} files).`);
  }
  const headScan = [...changedNew]
    .sort(compareStrings)
    .filter((p) => scannable(p) && (!partial || touched.has(mapper.component(p) ?? "")));

  const readBase = (p: string) => readBlobs(root, mergeBase, [p]).get(p) ?? null;
  const readHead = (p: string): string | null => {
    if (headRev) return readBlobs(root, headRev, [p]).get(p) ?? null;
    const path = join(root, p);
    if (!existsSync(path)) return null;
    try {
      return decodeText(readFileSync(path));
    } catch {
      return null;
    }
  };
  // Files are read in chunks and only their references are kept: a big repository never sits in memory whole.
  const extractAll = (rev: string | null, paths: string[], into: Map<string, Extracted>) => {
    for (let i = 0; i < paths.length; i += SCAN_CHUNK) {
      const chunk = paths.slice(i, i + SCAN_CHUNK);
      const texts = rev ? readBlobs(root, rev, chunk) : new Map(chunk.map((p) => [p, readHead(p)]));
      for (const p of chunk) into.set(p, extractRefs(p, texts.get(p) ?? null));
    }
  };
  const baseExtracted = new Map<string, Extracted>();
  extractAll(mergeBase, baseScan, baseExtracted);
  const headExtracted = new Map<string, Extracted>([...baseExtracted].filter(([p]) => !changedOld.has(p)));
  extractAll(headRev, headScan, headExtracted);
  const sortedBase = [...baseFiles].sort(compareStrings);
  const baseTs = loadTsConfigs(sortedBase, readBase);
  const headTs = [...changedNew].some((p) => p.includes("tsconfig"))
    ? loadTsConfigs([...headFiles].sort(compareStrings), readHead)
    : baseTs;
  const openspec = collectOpenSpec(files, headFiles, baseFiles, readHead, readBase, specs);
  const base = buildGraph(baseExtracted, new SideIndex(baseFiles, mapper, baseTs, baseExtracted), mapper);
  const head = buildGraph(headExtracted, new SideIndex(headFiles, mapper, headTs, headExtracted), mapper);
  return { base, head, openspec, ports: portLinks(headExtracted, mapper) };
}

/**
 * Dependencies of touched components that the change creates, removes or makes relevant, with rule violations.
 * An unchanged dependency is relevant only when a changed file references the target, or when it points at a file
 * whose public surface changed (callers may break). Everything else is background and would only add noise.
 */
function relevantDependencies(
  config: Config,
  files: AnalyzedFile[],
  symbols: SymbolFacts[],
  base: SideGraph,
  head: SideGraph,
  touched: Set<string>,
): DependencyFacts[] {
  const layerOf = new Map(config.components.map((c) => [c.id, c.layer]));
  const changedPaths = new Set([
    ...files.map((f) => f.path),
    ...files.flatMap((f) => (f.previousPath ? [f.previousPath] : [])),
  ]);
  const surfaceChanged = new Set([
    ...files.filter((f) => f.status === "D" || f.status === "R").map((f) => f.path),
    ...files.filter((f) => f.status === "R").map((f) => f.previousPath as string),
    ...symbols.filter((s) => s.delta !== "added").map((s) => s.file),
  ]);
  const out: DependencyFacts[] = [];
  const keys = [...new Set([...base.edges.keys(), ...head.edges.keys()])].map(splitEdgeKey).sort(byKeys((k) => k));
  for (const [from, to] of keys) {
    if (!touched.has(from) && !touched.has(to)) continue;
    const b = base.edges.get(edgeKey(from, to));
    const h = head.edges.get(edgeKey(from, to));
    const delta = b && h ? (b.count !== h.count ? "changed" : "unchanged") : h ? "added" : "removed";
    const sources = new Map([...(b?.lines ?? []), ...(h?.lines ?? [])]);
    const targets = new Set([...(b?.targets ?? []), ...(h?.targets ?? [])]);
    if (
      delta === "unchanged" &&
      ![...sources.keys()].some((s) => changedPaths.has(s)) &&
      ![...targets].some((t) => surfaceChanged.has(t))
    ) {
      continue;
    }
    const examples = [...sources.entries()]
      .sort(byKeys(([file]) => [!changedPaths.has(file), file]))
      .slice(0, 3)
      .map(([file, line]) => `${file}:${line}`);
    const rule = h ? ruleViolation(from, to, config, layerOf) : null;
    out.push({
      from,
      to,
      delta,
      baseCount: b?.count ?? 0,
      headCount: h?.count ?? 0,
      examples,
      violation: rule ? { rule, preexisting: Boolean(b) } : null,
    });
  }
  return out;
}

/** Touched components (added, changed or removed) and their neighbors on drawn dependencies, in config order. */
function componentRows(
  config: Config,
  mapper: Mapper,
  files: AnalyzedFile[],
  dependencies: DependencyFacts[],
  touched: Set<string>,
  baseFiles: Set<string>,
  headFiles: Set<string>,
): ComponentFacts[] {
  const baseHas = new Set([...baseFiles].map((p) => mapper.component(p)));
  const headHas = new Set([...headFiles].map((p) => mapper.component(p)));
  const neighbors = new Set(dependencies.flatMap((e) => [e.from, e.to]).filter((id) => !touched.has(id)));
  const rows: ComponentFacts[] = [];
  for (const c of config.components) {
    let delta: ComponentFacts["delta"];
    if (touched.has(c.id)) delta = !baseHas.has(c.id) ? "added" : !headHas.has(c.id) ? "removed" : "changed";
    else if (neighbors.has(c.id)) delta = "unchanged";
    else continue;
    const own = files.filter((f) => f.component === c.id && f.category !== "test" && f.category !== "ignored");
    rows.push({
      id: c.id,
      delta,
      files: own.length,
      additions: own.reduce((a, f) => a + f.additions, 0),
      deletions: own.reduce((a, f) => a + f.deletions, 0),
    });
  }
  return rows;
}

function changeStats(files: AnalyzedFile[], dependencies: DependencyFacts[], unresolved: number): Stats {
  const counted = files.filter((f) => f.category !== "ignored");
  const tests = files.filter((f) => f.category === "test");
  // How much of the change the map can show: lines in code, config and migration files that a component holds.
  const mappable = files.filter((f) => f.category === "code" || f.category === "config" || f.category === "migration");
  const sum = (fs: AnalyzedFile[], k: "additions" | "deletions") => fs.reduce((a, f) => a + f[k], 0);
  return {
    files: files.length,
    additions: sum(counted, "additions"),
    deletions: sum(counted, "deletions"),
    testAdditions: sum(tests, "additions"),
    testDeletions: sum(tests, "deletions"),
    unmapped: files
      .filter((f) => !f.component && f.category === "code")
      .map((f) => f.path)
      .sort(compareStrings),
    unresolved,
    newViolations: dependencies.filter((e) => e.violation && !e.violation.preexisting).length,
    codeLines: mappable.reduce((a, f) => a + f.additions + f.deletions, 0),
    mappedLines: mappable.filter((f) => f.component).reduce((a, f) => a + f.additions + f.deletions, 0),
  };
}

const COVERAGE_MIN = 80; // percent of the changed code lines that a component holds
const COVERAGE_MIN_LINES = 20; // smaller changes never warn

/** When the map shows too little of the change, the folders it misses: the config has drifted from the code. */
function coverageNotes(files: AnalyzedFile[], stats: Stats): string[] {
  if (stats.codeLines < COVERAGE_MIN_LINES) return [];
  const pct = Math.round((100 * stats.mappedLines) / stats.codeLines);
  if (pct >= COVERAGE_MIN) return [];
  const dirs = new Map<string, number>();
  for (const f of files) {
    if (!f.component && (f.category === "code" || f.category === "config" || f.category === "migration")) {
      const d = f.path.split("/").slice(0, -1).slice(0, 2).join("/") || ".";
      dirs.set(d, (dirs.get(d) ?? 0) + 1);
    }
  }
  const top = [...dirs.entries()].sort(byKeys(([d, n]) => [-n, d]));
  const where =
    top
      .slice(0, 5)
      .map(([d, n]) => `${d} (${n} file${n > 1 ? "s" : ""})`)
      .join(", ") + (top.length > 5 ? " …" : "");
  return [
    `Only ${pct}% of the changed code is on the map; no component holds ${where}. ` +
      `Add them to ${CONFIG_NAME} (\`explain-change check\` lists every unmapped file).`,
  ];
}

/**
 * Identifies the change an explanation was written for: the diff, the config, the contract and the analysis.
 * CRLF from a Windows checkout must not change it.
 */
function changeKey(root: string, rawDiff: string, specs: string[]): string {
  const configPath = join(root, CONFIG_NAME);
  const configText = existsSync(configPath) ? readFileSync(configPath, "utf8").replace(/\r\n/g, "\n") : "";
  const parts = [rawDiff, configText, String(CONTRACT_VERSION), [...specs].sort().join(","), String(ANALYSIS_VERSION)];
  return createHash("sha256").update(parts.join("\0"), "utf8").digest("hex").slice(0, 16);
}

/** The part of the config the digest and the report show. */
function publicConfig(config: Config, root: string): PublicConfig {
  return {
    inferred: config.inferred,
    name: config.name || basename(root),
    direction: config.direction,
    lang: config.lang,
    layers: config.layers,
    components: config.components.map(({ id, name, layer, desc }) => ({ id, name, layer, desc })),
    rules: {
      allow: config.rules.allow.map(([a, b]) => `${a} -> ${b}`),
      forbid: config.rules.forbid.map(([a, b]) => `${a} -> ${b}`),
    },
    referenceFlows: config.flows,
    glossary: config.glossary,
  };
}
