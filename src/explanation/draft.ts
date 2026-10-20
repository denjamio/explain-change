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
/**
 * A placeholder's limit, in characters and in words: an agent writes to a word count more closely than to a character
 * count (in the evals, a story body over its limit cost a round of fixes in most runs). About 7 characters a word.
 */
// Words first: agents count words, not characters (too-long was the first cause of a second render).
const size = (chars: number) => `≤${Math.floor(chars / 7)} words (${chars} chars)`;

export function draftExplanation(facts: Facts): Record<string, unknown> {
  const { outline } = facts;
  const out: Record<string, unknown> = {
    version: CONTRACT_VERSION,
    key: facts.key,
    lang: facts.config.lang,
    tldr: `<${size(L.tldr)}: what changes and its effect, in the present, no would/could: 'Bulk delete removes many folders in 1 call'>`,
    goal: `<${size(L.goal)}: the need or problem behind it, not a repeat of tldr, in the present, no would/could: 'Admins cannot see which numbers fail'>`,
    story: outline.story.map((s) => ({
      heading: `<${size(L["story.heading"])}, on ${s.about}: the thing + what happened to it>`,
      body: `<${size(L["story.body"])}: what behaves differently now, in the present, no would/could: 'The job retries a failed send'>`,
      view: s.view,
      focus: s.view === "data" ? ["<entity-id>"] : s.focus,
      ...(s.code ? { code: s.code } : {}),
    })),
  };
  const candidate = outline.keyDependencyCandidates[0];
  if (candidate) {
    out.keyDependencies = [{ ...candidate, label: `<${size(L["keyDependencies.label"])}, optional>` }];
  }
  out.components = changedComponents(facts).map((id) => ({
    id,
    summary: `<${size(L["components.summary"])}: what it now does differently>`,
  }));
  out.decisions = [
    {
      title: `<${size(L["decisions.title"])}: the choice>`,
      why: `<${size(L["decisions.why"])}: why, in the present, no would/could: 'Seat expansion is all or nothing'>`,
      basis: `<${decisionBases(facts).join("|")}>`,
      evidence: "<file:line inside a hunk, optional>",
    },
  ];
  if (facts.components.length >= 2) {
    const shown = new Set(facts.components.map((c) => c.id));
    const title = `<${size(L["flows.title"])}: the action, verb + object>`;
    const call = `<${size(L["flows.steps.call"])}: the call>`;
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
        trigger: `<${size(L["flows.trigger"])}: the code that starts it>`,
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
  // A migration's folder is not its entity's component: that is the one of the models the change edits, when they
  // all live in 1 (the validator checks it against the class).
  const modelOwners = new Set(
    facts.files.filter((f) => outline.dataFiles.includes(f.path) && f.category !== "migration").map((f) => f.component),
  );
  const [modelOwner] = modelOwners;
  const entityComponent =
    (dataFile?.category === "migration" ? (modelOwners.size === 1 ? modelOwner : null) : dataFile?.component) ??
    "<component-id>";
  if (dataFile?.hunks[0]) {
    out.dataModel = {
      entities: [
        {
          id: "<kebab-id>",
          name: `<${size(L["dataModel.entities.name"])}: the model or table>`,
          delta: DELTA_CHOICE,
          component: entityComponent,
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
    note: `<${size(L["requirements.note"])}: required for partial and missing, else optional>`,
  }));
  if (requirements.length) out.requirements = requirements;
  return out;
}
