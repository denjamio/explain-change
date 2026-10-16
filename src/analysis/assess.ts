import type { Mapper } from "../config/mapper.ts";
import type { Config } from "../contract/config.ts";
import { git, gitPaths, readBlobs } from "../core/git.ts";
import { langOf } from "../core/lang.ts";
import { byKeys, compareStrings } from "../core/text.ts";
import { buildGraph, ruleViolation, splitEdgeKey } from "./graph.ts";
import { type Extracted, extractRefs } from "./refs.ts";
import { loadTsConfigs, SideIndex } from "./resolve.ts";

/**
 * How the config fits the code as it is, for `explain-change check`: the evidence to draw boundaries with. Read at
 * HEAD (committed code), deterministic, no LLM.
 *
 * - violations: dependencies between components that break [rules] today;
 * - cycles: components that depend on each other, the usual sign of a boundary drawn in the wrong place;
 * - cochange: components that change in the same commits: one context split in two, or a boundary that leaks.
 */
export interface Assessment {
  files: number;
  violations: { from: string; to: string; refs: number; rule: string; example: string }[];
  cycles: { a: string; b: string; refsAB: number; refsBA: number }[];
  cochange: { a: string; b: string; commits: number; coupling: number }[];
  commits: number;
}

const CHUNK = 500;
/** Commits that touch more components than this are mass edits (renames, formatting): they say nothing about boundaries. */
const MASS_EDIT = 12;

export function assessArchitecture(root: string, config: Config, mapper: Mapper, history = 300): Assessment {
  const tree = gitPaths(["ls-tree", "-r", "--name-only", "HEAD"], root).sort(compareStrings);
  const scannable = tree.filter((p) => langOf(p) && ["code", "config"].includes(mapper.category(p)));
  const extracted = new Map<string, Extracted>();
  for (let i = 0; i < scannable.length; i += CHUNK) {
    const chunk = scannable.slice(i, i + CHUNK);
    const texts = readBlobs(root, "HEAD", chunk);
    for (const p of chunk) extracted.set(p, extractRefs(p, texts.get(p) ?? null));
  }
  const tsconfigs = loadTsConfigs(tree, (p) => readBlobs(root, "HEAD", [p]).get(p) ?? null);
  const graph = buildGraph(extracted, new SideIndex(new Set(tree), mapper, tsconfigs, extracted), mapper);
  const layerOf = new Map(config.components.map((c) => [c.id, c.layer]));

  const violations: Assessment["violations"] = [];
  const cycles: Assessment["cycles"] = [];
  for (const [key, e] of graph.edges) {
    const [from, to] = splitEdgeKey(key);
    const rule = ruleViolation(from, to, config, layerOf);
    const first = [...e.lines.entries()].sort(byKeys(([f]) => [f]))[0];
    if (rule) violations.push({ from, to, refs: e.count, rule, example: first ? `${first[0]}:${first[1]}` : "" });
    const back = graph.edges.get(`${to}\0${from}`);
    if (back && compareStrings(from, to) < 0) cycles.push({ a: from, b: to, refsAB: e.count, refsBA: back.count });
  }
  violations.sort(byKeys((v) => [-v.refs, v.from, v.to]));
  cycles.sort(byKeys((c) => [-(c.refsAB + c.refsBA), c.a, c.b]));

  // Co-change: per commit, the set of components its non-test files belong to.
  const log = git(["log", "-n", String(history), "--no-merges", "--name-only", "--format=format:@"], root, {
    check: false,
  });
  // With 3 lanes or more, the bottom one holds what every lane uses; with 2, it is the domain itself.
  const bottomLayer = config.layers.length >= 3 ? config.layers.at(-1)?.id : undefined;
  const bottom = new Set(config.components.filter((c) => c.layer === bottomLayer).map((c) => c.id));
  const perComponent = new Map<string, number>();
  const pairs = new Map<string, number>();
  let commits = 0;
  for (const block of log.split("@").slice(1)) {
    const comps = new Set<string>();
    for (const path of block.split("\n")) {
      if (!path || ["test", "ignored", "docs"].includes(mapper.category(path))) continue;
      const c = mapper.component(path);
      if (c) comps.add(c);
    }
    commits++;
    if (!comps.size || comps.size > MASS_EDIT) continue;
    const list = [...comps].sort(compareStrings);
    for (const c of list) perComponent.set(c, (perComponent.get(c) ?? 0) + 1);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const k = `${list[i]}\0${list[j]}`;
        pairs.set(k, (pairs.get(k) ?? 0) + 1);
      }
    }
  }
  const cochange = [...pairs.entries()]
    .map(([k, n]) => {
      const [a, b] = splitEdgeKey(k);
      const coupling = n / Math.min(perComponent.get(a) ?? n, perComponent.get(b) ?? n);
      return { a, b, commits: n, coupling: Math.round(coupling * 100) / 100 };
    })
    // At least 5 shared commits, and none with the bottom lane (the shared kernel or the platform), which changes
    // with everything: below that, coupling 1.0 from 3 commits is chance, not a boundary.
    .filter((p) => p.commits >= 5 && p.coupling >= 0.5 && !bottom.has(p.a) && !bottom.has(p.b))
    .sort(byKeys((p) => [-p.coupling, -p.commits, p.a, p.b]))
    .slice(0, 10);

  return {
    files: scannable.length,
    violations: violations.slice(0, 20),
    cycles: cycles.slice(0, 10),
    cochange,
    commits,
  };
}
