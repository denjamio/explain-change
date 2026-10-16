import { specRequirements } from "../analysis/openspec.ts";
import { EXPLANATION_FIELDS, type Explanation, type NormalizedExplanation } from "../contract/explanation.ts";
import type { Facts } from "../contract/facts.ts";
import { compareStrings } from "../core/text.ts";

/**
 * The explanation as the report reads it: optional parts filled in, lists in a stable order whatever order the
 * agent wrote them in, and each flow step checked against the code. A step is verified when the code has a
 * dependency between both components, in either direction, or when both depend on a common component (dependency
 * inversion: the application calls a port that infrastructure implements, and neither imports the other).
 */
export function normalizeExplanation(e: Explanation, facts: Facts): NormalizedExplanation {
  const layerRank = new Map(facts.config.layers.map((l, i) => [l.id, i]));
  const componentRank = new Map(
    facts.config.components.map((c, i) => [c.id, [layerRank.get(c.layer) ?? 99, i] as const]),
  );
  const rank = (id: string) => componentRank.get(id) ?? ([99, 999] as const);
  const linked = new Set(facts.dependencyGraph.flatMap(([a, b]) => [`${a}\0${b}`, `${b}\0${a}`]));
  const uses = new Map<string, Set<string>>();
  for (const [a, b] of facts.dependencyGraph) uses.set(a, (uses.get(a) ?? new Set()).add(b));
  const verify = (from: string, to: string) => {
    if (from === to || linked.has(`${from}\0${to}`)) return { verified: true, via: null };
    const both = [...(uses.get(from) ?? [])].filter((x) => uses.get(to)?.has(x)).sort(compareStrings);
    return { verified: both.length > 0, via: both[0] ?? null };
  };
  const requirementOrder = new Map(specRequirements(facts).map((r, i) => [r.id, i]));
  const normalized: NormalizedExplanation = {
    ...e,
    story: e.story.map((s) => ({ ...s, view: s.view ?? "architecture", focus: s.focus ?? [] })),
    keyDependencies: e.keyDependencies ?? [],
    components: [...e.components].sort((a, b) => {
      const [ra, rb] = [rank(a.id), rank(b.id)];
      return ra[0] - rb[0] || ra[1] - rb[1];
    }),
    decisions: e.decisions ?? [],
    flows: (e.flows ?? []).map((fl) => ({ ...fl, steps: fl.steps.map((s) => ({ ...s, ...verify(s.from, s.to) })) })),
    dataModel: {
      entities: (e.dataModel?.entities ?? []).map((en) => ({ ...en, fields: en.fields ?? [] })),
      relations: e.dataModel?.relations ?? [],
    },
    requirements: [...(e.requirements ?? [])]
      .map((r) => ({ ...r, components: r.components ?? [], tests: r.tests ?? [] }))
      .sort((a, b) => (requirementOrder.get(a.id) ?? 999) - (requirementOrder.get(b.id) ?? 999)),
  };
  // One key order, whatever order the agent wrote: same explanation → same page.
  return Object.fromEntries(
    EXPLANATION_FIELDS.filter((k) => k in normalized).map((k) => [k, normalized[k as keyof NormalizedExplanation]]),
  ) as unknown as NormalizedExplanation;
}
