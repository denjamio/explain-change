import type { Mapper } from "../config/mapper.ts";
import type { Config } from "../contract/config.ts";
import { compareStrings } from "../core/text.ts";
import type { Extracted } from "./refs.ts";
import type { SideIndex } from "./resolve.ts";

/** Component → component dependencies of one side of the change. */
export interface SideEdge {
  /** One per source file and target (file, or raw specifier when the file is unknown). */
  count: number;
  /** Source file → the first line that references the target. */
  lines: Map<string, number>;
  targets: Set<string>;
}

export interface SideGraph {
  edges: Map<string, SideEdge>; // "from\0to"
  unresolved: number;
}

export const edgeKey = (from: string, to: string) => `${from}\0${to}`;
export const splitEdgeKey = (key: string) => key.split("\0") as [string, string];

export function buildGraph(extracted: ReadonlyMap<string, Extracted>, index: SideIndex, mapper: Mapper): SideGraph {
  const edges = new Map<string, SideEdge>();
  let unresolved = 0;
  for (const src of [...extracted.keys()].sort(compareStrings)) {
    const from = mapper.component(src);
    if (!from) continue;
    const seen = new Set<string>();
    for (const ref of (extracted.get(src) as Extracted).refs) {
      const r = index.resolve(src, ref);
      if (r.kind === "unresolved") {
        unresolved++;
        continue;
      }
      if (r.kind !== "component") continue;
      for (const to of r.components) {
        if (to === from) continue;
        const dedupe = `${to}|${r.file ?? ref.raw}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const key = edgeKey(from, to);
        const e = edges.get(key) ?? { count: 0, lines: new Map(), targets: new Set() };
        edges.set(key, e);
        e.count++;
        if (!e.lines.has(src)) e.lines.set(src, ref.line);
        if (r.file) e.targets.add(r.file);
      }
    }
  }
  return { edges, unresolved };
}

/**
 * The rule a dependency breaks, or null. Rules name layers or components: `forbid` always wins; with an `allow`
 * list, a dependency between layers must match one of its entries (inside a layer it is allowed unless
 * same_layer = false).
 */
export function ruleViolation(
  from: string,
  to: string,
  config: Config,
  layerOf: ReadonlyMap<string, string>,
): string | null {
  const { allow, forbid, sameLayer } = config.rules;
  const fromLayer = layerOf.get(from) as string;
  const toLayer = layerOf.get(to) as string;
  const pairs = [from, fromLayer].flatMap((a) => [to, toLayer].map((b) => [a, b] as const));
  const has = (list: [string, string][], [a, b]: readonly [string, string]) =>
    list.some(([x, y]) => x === a && y === b);
  for (const pair of pairs) if (has(forbid, pair)) return `forbidden: ${pair[0]} -> ${pair[1]}`;
  if (!allow.length) return null;
  if (sameLayer && fromLayer === toLayer) return null;
  if (pairs.some((p) => has(allow, p))) return null;
  return `not allowed: ${fromLayer} -> ${toLayer}`;
}
