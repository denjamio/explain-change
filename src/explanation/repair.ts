import type { Facts } from "../contract/facts.ts";
import { LOCATION_RE } from "../contract/facts.ts";
import { hunkRanges } from "./validate.ts";

/** How far outside a hunk a location may start and still be moved onto it, in lines. */
export const SNAP_LINES = 20;

/**
 * Mechanical fixes `render` applies before it validates, so they cost the agent no round of fixes: a location a
 * few lines outside a hunk of its file (the agent read the file at the head and cited the line next to the change)
 * moves onto that hunk, keeping its length (in an added file, any line does). In the eval runs, a location outside the hunks was the most common
 * cause of a second render. A location far from every hunk, or in a file outside the change, is left to the
 * validator. Returns the fixed explanation and 1 line per fix.
 */
export function repairExplanation(value: unknown, facts: Facts): { value: unknown; fixes: string[] } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { value, fixes: [] };
  const files = new Map(facts.files.map((f) => [f.path, f]));
  const fixes: string[] = [];
  const snap = (path: string, loc: unknown): unknown => {
    if (typeof loc !== "string") return loc;
    const m = LOCATION_RE.exec(loc);
    const f = m ? files.get(m[1] as string) : undefined;
    if (!m || !f?.hunks.length) return loc;
    const a = Number(m[2]);
    const b = Math.max(a, Number(m[3] ?? m[2]));
    const ranges = hunkRanges(f);
    if (ranges.some(([lo, hi]) => a <= hi && b >= lo)) return loc;
    const gap = ([lo, hi]: [number, number]) => (b < lo ? lo - b : a - hi);
    // An added file is 1 hunk, the whole file: any line the agent names in it is in the change.
    const reach = f.delta === "added" ? Number.POSITIVE_INFINITY : SNAP_LINES;
    const near = ranges.filter((r) => gap(r) <= reach).sort((x, y) => gap(x) - gap(y) || x[0] - y[0])[0];
    if (!near) return loc;
    const [lo, hi] = near;
    const len = Math.min(b - a, hi - lo);
    const [na, nb] = b < lo ? [lo, lo + len] : [hi - len, hi];
    const fixed = `${m[1]}:${na === nb ? na : `${na}-${nb}`}`;
    fixes.push(`${path}: ${loc} → ${fixed} (the nearest hunk)`);
    return fixed;
  };
  const e = { ...(value as Record<string, unknown>) };
  const each = (field: string, at: (i: number) => string, list: unknown) =>
    Array.isArray(list)
      ? list.map((x, i) =>
          typeof x === "object" && x !== null && field in x ? { ...x, [field]: snap(at(i), x[field]) } : x,
        )
      : list;
  if ("story" in e) e.story = each("code", (i) => `story[${i}].code`, e.story);
  if ("decisions" in e) e.decisions = each("evidence", (i) => `decisions[${i}].evidence`, e.decisions);
  const dm = e.dataModel;
  if (typeof dm === "object" && dm !== null && !Array.isArray(dm) && "entities" in dm) {
    const entities = (dm as Record<string, unknown>).entities;
    e.dataModel = { ...dm, entities: each("evidence", (i) => `dataModel.entities[${i}].evidence`, entities) };
  }
  return fixes.length ? { value: e, fixes } : { value, fixes };
}
