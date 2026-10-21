import { specRequirements } from "../analysis/openspec.ts";
import { EXPLANATION_FIELDS, type Explanation, type NormalizedExplanation } from "../contract/explanation.ts";
import type { Facts } from "../contract/facts.ts";
import { digits } from "./prose.ts";

/**
 * The explanation as the report reads it: optional parts filled in, lists in a stable order whatever order the
 * agent wrote them in, and each flow step checked against the code. A step is verified through a port when 1 side
 * implements an interface the other declares (dependency inversion: Core calls IFolderRepository, Dapper implements
 * it), else when the code has a dependency between both components, in either direction. Sharing a third
 * dependency is no evidence: in the examples it named the wrong reason 3 times in 4. Counts in the prose are written
 * as digits.
 */
export function normalizeExplanation(raw: Explanation, facts: Facts): NormalizedExplanation {
  const e = proseDigits(raw);
  const layerRank = new Map(facts.config.layers.map((l, i) => [l.id, i]));
  const componentRank = new Map(
    facts.config.components.map((c, i) => [c.id, [layerRank.get(c.layer) ?? 99, i] as const]),
  );
  const rank = (id: string) => componentRank.get(id) ?? ([99, 999] as const);
  const linked = new Set(facts.dependencyGraph.flatMap(([a, b]) => [`${a}\0${b}`, `${b}\0${a}`]));
  const ports = new Map(
    facts.ports.flatMap((p) => [
      [`${p.from}\0${p.to}`, p.interfaces] as const,
      [`${p.to}\0${p.from}`, p.interfaces] as const,
    ]),
  );
  // The port a step goes through: the interface its call names (IFolderRepository.DeleteManyAsync), or the only
  // 1. With several and none named, the step is verified through a port without naming 1: a wrong name is worse.
  const verify = (from: string, to: string, call: string) => {
    if (from === to) return { verified: true, port: false, via: null };
    const interfaces = ports.get(`${from}\0${to}`);
    if (interfaces?.length) {
      const named = interfaces.find((i) => call.includes(i)) ?? (interfaces.length === 1 ? interfaces[0] : undefined);
      return { verified: true, port: true, via: named ?? null };
    }
    return { verified: linked.has(`${from}\0${to}`), port: false, via: null };
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
    flows: (e.flows ?? []).map((fl) => ({
      ...fl,
      steps: fl.steps.map((s) => ({ ...s, ...verify(s.from, s.to, s.call) })),
    })),
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

/** The prose fields with counts as digits ("three files" → "3 files"); ids, code and evidence stay as written. */
function proseDigits(e: Explanation): Explanation {
  const d = <T extends string | undefined>(v: T): T => (typeof v === "string" ? digits(v) : v) as T;
  return {
    ...e,
    tldr: d(e.tldr),
    goal: d(e.goal),
    story: e.story.map((s) => ({ ...s, heading: d(s.heading), body: d(s.body) })),
    components: e.components.map((c) => ({ ...c, summary: d(c.summary) })),
    ...(e.decisions && {
      // An alternative (contract 5 before 0.16) is dropped: the explanation says what was built and why, not what was not.
      decisions: e.decisions.map(
        ({ alternative: _, ...x }: (typeof e.decisions)[number] & { alternative?: unknown }) => ({
          ...x,
          title: d(x.title),
          why: d(x.why),
        }),
      ),
    }),
    ...(e.flows && { flows: e.flows.map((f) => ({ ...f, title: d(f.title) })) }),
    ...(e.keyDependencies && { keyDependencies: e.keyDependencies.map((k) => ({ ...k, label: d(k.label) })) }),
    ...(e.dataModel?.relations && {
      dataModel: { ...e.dataModel, relations: e.dataModel.relations.map((r) => ({ ...r, label: d(r.label) })) },
    }),
    ...(e.requirements && { requirements: e.requirements.map((r) => ({ ...r, note: d(r.note) })) }),
    ...(e.since && {
      since: {
        ...e.since,
        summary: d(e.since.summary),
        ...(e.since.components && {
          components: e.since.components.map((c) => ({ ...c, summary: d(c.summary) })),
        }),
      },
    }),
  };
}
