import { mappableRequirements, specRequirements } from "../analysis/openspec.ts";
import { hunkRef } from "../analysis/outline.ts";
import { LIMITS, REQUIREMENT_STATUSES } from "../contract/explanation.ts";
import type { Facts } from "../contract/facts.ts";
import { DELTAS } from "../contract/facts.ts";
import { CONTRACT_VERSION } from "../core/constants.ts";
import { changedComponents, decisionBases } from "./validate.ts";

const L = LIMITS;
const DELTA_CHOICE = `<${DELTAS.join("|")}>`;

/** The names a reference step calls: `place_order`, `Product.reserve` → `Product`, `reserve`. */
function callNames(message: string): string[] {
  return (message.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).filter((w) => w.length >= 4);
}

/**
 * Whether the change touches a reference flow: every name 1 of its steps calls (`Order` and `place` for
 * `Order.place`) is on a changed line or names the function a hunk is in. Sharing a component is not enough: in a
 * large app every flow shares 1 with every change, and 1 word alone (`create`) matches too much.
 */
export function changeReaches(facts: Pick<Facts, "files">, flow: Facts["config"]["referenceFlows"][number]): boolean {
  const touched = new Set<string>();
  for (const f of facts.files) {
    if (f.category === "test") continue;
    for (const h of f.hunks) {
      for (const w of callNames(h.header)) touched.add(w);
      for (const [mark, line] of h.lines) if (mark !== " ") for (const w of callNames(line)) touched.add(w);
    }
  }
  return flow.steps.some((s) => {
    const names = callNames(s.message);
    return names.length > 0 && names.every((w) => touched.has(w));
  });
}

/**
 * The explanation.json the agent fills in: valid JSON whose ids, views, focus, code references and evidence are
 * already right. Each "<…>" is the agent's: words within the limit it states, or one of the values it lists.
 * Optional parts say so: fill them or delete them.
 */
export function draftExplanation(facts: Facts): Record<string, unknown> {
  const { outline } = facts;
  const out: Record<string, unknown> = {
    version: CONTRACT_VERSION,
    key: facts.key,
    lang: facts.config.lang,
    tldr: `<≤${L.tldr} chars: what changes and its effect>`,
    goal: `<≤${L.goal} chars: the need or problem behind it, not a repeat of tldr>`,
    story: outline.story.map((s) => ({
      heading: `<≤${L["story.heading"]}: ${s.about}>`,
      body: `<≤${L["story.body"]}: what behaves differently now>`,
      view: s.view,
      focus: s.view === "data" ? ["<entity-id>"] : s.focus,
      ...(s.code ? { code: s.code } : {}),
    })),
  };
  const candidate = outline.keyDependencyCandidates[0];
  if (candidate) {
    out.keyDependencies = [{ ...candidate, label: `<≤${L["keyDependencies.label"]}, optional>` }];
  }
  out.components = changedComponents(facts).map((id) => ({
    id,
    summary: `<≤${L["components.summary"]}: what it now does differently>`,
  }));
  out.decisions = [
    {
      title: `<≤${L["decisions.title"]}: the choice>`,
      why: `<≤${L["decisions.why"]}: why>`,
      basis: `<${decisionBases(facts).join("|")}>`,
      alternative: `<≤${L["decisions.alternative"]}: the main alternative, optional>`,
      evidence: "<file:line inside a hunk, optional>",
    },
  ];
  if (facts.components.length >= 2) {
    const shown = new Set(facts.components.map((c) => c.id));
    const title = `<≤${L["flows.title"]}: the action, verb + object>`;
    const call = `<≤${L["flows.steps.call"]}: the call>`;
    const flows: Record<string, unknown>[] = outline.flows.map((fl) => ({
      id: fl.id,
      title,
      trigger: fl.trigger,
      steps: fl.steps.map((s) => ({ ...s, call: s.call || call })),
    }));
    const reference = facts.config.referenceFlows.find(
      (fl) => fl.steps.some((s) => shown.has(s.from) || shown.has(s.to)) && changeReaches(facts, fl),
    );
    if (reference) {
      flows.unshift({
        id: reference.id,
        title: reference.title,
        steps: reference.steps.map((s) => ({ from: s.from, to: s.to, call: s.message || call, delta: "unchanged" })),
      });
    }
    if (!flows.length) {
      flows.push({
        id: "<kebab-id>",
        title,
        trigger: `<≤${L["flows.trigger"]}: the code that starts it>`,
        steps: [
          {
            from: "<component-id>",
            to: "<component-id>",
            call,
            delta: DELTA_CHOICE,
            data: { type: "<the type that travels, optional>", fields: ["<+email: string>"] },
          },
        ],
      });
    }
    const first = flows[0] as Record<string, unknown>;
    if (specRequirements(facts).some((r) => r.scenarios.length))
      first.scenario = "<requirement-id#scenario-id, optional>";
    out.flows = flows.slice(0, L.flows);
  }
  const dataPath = outline.dataFiles[0];
  const dataFile = facts.files.find((f) => f.path === dataPath);
  if (dataFile?.hunks[0]) {
    out.dataModel = {
      entities: [
        {
          id: "<kebab-id>",
          name: `<≤${L["dataModel.entities.name"]}: the model or table>`,
          delta: DELTA_CHOICE,
          component: dataFile.component ?? "<component-id>",
          fields: ["<+email: string>"],
          evidence: hunkRef(dataFile, dataFile.hunks[0]),
        },
      ],
      relations: [{ from: "<entity-id>", to: "<entity-id>", label: "<1..n, optional>", delta: DELTA_CHOICE }],
    };
  }
  const requirements = mappableRequirements(facts).map((r) => ({
    id: r.id,
    status: `<${REQUIREMENT_STATUSES.join("|")}>`,
    components: ["<component-id>"],
    tests: ["<path[:line] of a test, optional>"],
    note: `<≤${L["requirements.note"]}: required for partial and missing, else optional>`,
  }));
  if (requirements.length) out.requirements = requirements;
  return out;
}
