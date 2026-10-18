import { existsSync } from "node:fs";
import { join } from "node:path";
import { mappableRequirements, specRequirements } from "../analysis/openspec.ts";
import { DECISION_BASES, ENUMS, EXPLANATION_FIELDS, KEBAB_RE, LIMITS, STORY_MIN } from "../contract/explanation.ts";
import type { Facts, FileFacts } from "../contract/facts.ts";
import { LOCATION_RE } from "../contract/facts.ts";
import { CONTRACT_VERSION } from "../core/constants.ts";
import { cpLength, cpSlice } from "../core/text.ts";
import { ProseChecker } from "./prose.ts";

/** Why a field is rejected. Stable: agents and tools may branch on it. */
export type IssueCode =
  | "invalid-json"
  | "placeholder"
  | "stale"
  | "unknown-field"
  | "required"
  | "type"
  | "too-long"
  | "too-many"
  | "too-few"
  | "not-allowed"
  | "unknown-id"
  | "duplicate"
  | "missing"
  | "location"
  | "basis"
  | "sentence-too-long"
  | "refused-word"
  | "passive"
  | "unknown-code-name"
  | "title";

export interface Issue {
  /** The field, as a JSON path: `story[2].heading`. */
  path: string;
  code: IssueCode;
  message: string;
}

export const formatIssue = (i: Issue) => `${i.path}: ${i.message}`;

/** Components of the change (on the map), then the rest of the config: the ids flows and requirements may name. */
export function explainableComponents(facts: Pick<Facts, "components" | "config">): string[] {
  const shown = facts.components.map((c) => c.id);
  return [...shown, ...facts.config.components.map((c) => c.id).filter((id) => !shown.includes(id))];
}

/** The decision bases this change has a source for: pr and spec only when it has a PR description or a spec. */
export function decisionBases(facts: Pick<Facts, "source" | "openspec">): string[] {
  return DECISION_BASES.filter(
    (b) =>
      (b !== "pr" || Boolean(facts.source.description.trim())) &&
      (b !== "spec" || Boolean(facts.openspec?.changes.some((c) => c.why || c.decisions.length || c.artifacts.length))),
  );
}

export const changedComponents = (facts: Pick<Facts, "components">) =>
  facts.components.filter((c) => c.delta !== "unchanged").map((c) => c.id);

/** A string the draft left for the agent: "<≤280 chars: …>", "<entity-id>". */
export const PLACEHOLDER_RE = /^<[^<>]*>$/s;

type Json = unknown;
/** A value the draft left for the agent: reported once as a placeholder, skipped by every other check. */
const isHole = (v: Json) => typeof v === "string" && PLACEHOLDER_RE.test(v.trim());
type Obj = Record<string, Json>;
const isObject = (v: Json): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function hunkRanges(f: FileFacts): [number, number][] {
  return f.hunks.map((h) => {
    const [start, len] = f.delta === "removed" ? [h.oldStart, h.oldLines] : [h.newStart, h.newLines];
    return [start, start + Math.max(len, 1) - 1];
  });
}

/**
 * Every problem with an explanation, each with its JSON path, a stable code and what to write instead. Empty when
 * valid. Tolerant: one pass reports every problem, so one round of fixes is enough.
 */
export function validateExplanation(value: Json, facts: Facts, root: string | null): Issue[] {
  if (!isObject(value)) return [{ path: "explanation", code: "type", message: "must be a JSON object" }];
  const issues = new Validator(facts, root).run(value);
  // A placeholder hides what will be written there: report the placeholder, not what it breaks.
  const holes = placeholders(value, "");
  if (!holes.length) return issues;
  const covered = (path: string) =>
    holes.some((h) => path === h || path.startsWith(`${h}.`) || path.startsWith(`${h}[`));
  return [
    ...holes.map((path) => ({
      path,
      code: "placeholder" as const,
      message: "still a placeholder: write it, or delete the field if it is optional",
    })),
    ...issues.filter((i) => !covered(i.path)),
  ];
}

function placeholders(v: Json, path: string): string[] {
  if (typeof v === "string") return PLACEHOLDER_RE.test(v.trim()) ? [path] : [];
  if (Array.isArray(v)) return v.flatMap((x, i) => placeholders(x, `${path}[${i}]`));
  if (isObject(v)) return Object.entries(v).flatMap(([k, x]) => placeholders(x, path ? `${path}.${k}` : k));
  return [];
}

class Validator {
  private readonly issues: Issue[] = [];
  private readonly componentIds: Set<string>;
  private readonly files: Map<string, FileFacts>;
  private readonly requirementIds: string[];
  private readonly prose: ProseChecker;

  constructor(
    private readonly facts: Facts,
    private readonly root: string | null,
  ) {
    this.componentIds = new Set(explainableComponents(facts));
    this.files = new Map(facts.files.map((f) => [f.path, f]));
    this.requirementIds = specRequirements(facts).map((r) => r.id);
    this.prose = new ProseChecker(facts, root);
  }

  run(e: Obj): Issue[] {
    this.header(e);
    this.text("tldr", e.tldr, LIMITS.tldr);
    this.text("goal", e.goal, LIMITS.goal);
    this.components(e.components);
    this.decisions(e.decisions);
    const flowSteps = this.flows(e.flows);
    const entityIds = this.dataModel(e.dataModel);
    this.requirements(e.requirements);
    this.keyDependencies(e.keyDependencies);
    this.story(e.story, flowSteps, entityIds);
    return this.issues;
  }

  private add(path: string, code: IssueCode, message: string) {
    this.issues.push({ path, code, message });
  }

  // ── field helpers ──

  private text(path: string, value: Json, limit: number, opts: { required?: boolean; names?: boolean } = {}) {
    const { required = true, names = true } = opts;
    if (isHole(value)) return;
    if (value === undefined || value === null || value === "") {
      if (required) this.add(path, "required", "required");
    } else if (typeof value !== "string" || !value.trim()) this.add(path, "type", "must be a non-empty string");
    else {
      // Every problem in 1 pass: a field too long is also checked for prose, so a cut is not followed by a fix.
      const over = cpLength(value) - limit;
      if (over > 0) {
        const words = Math.max(1, Math.ceil(over / 7));
        // The words past the limit, so the cut needs no counting (agents count characters badly).
        const past = cpSlice(value, limit);
        this.add(
          path,
          "too-long",
          `${cpLength(value)} chars, max ${limit}: cut ${over}+ chars (about ${words} words); past the limit: "${past}"`,
        );
      }
      for (const i of this.prose.check(value, names)) this.add(path, i.code, i.message);
    }
  }

  private fields(path: string, value: Json, maxItems: number, limit: number) {
    if (value === undefined || value === null) return;
    if (!Array.isArray(value)) return this.add(path, "type", "must be an array of strings");
    if (value.length > maxItems) {
      this.add(path, "too-many", `${value.length} items, max ${maxItems}; keep the fields that matter for this change`);
    }
    value.forEach((f, k) => {
      if (typeof f !== "string" || !f.trim() || cpLength(f) > limit) {
        this.add(`${path}[${k}]`, "type", `a field like '+email: string' (max ${limit} chars)`);
      }
    });
  }

  private enumValue(path: string, value: Json, key: keyof typeof ENUMS) {
    const allowed = ENUMS[key] as readonly string[];
    if (isHole(value)) return;
    if (!allowed.includes(value as string))
      this.add(path, "not-allowed", `'${String(value)}' must be one of ${allowed.join(" | ")}`);
  }

  /** [index, item] for each object of an optional array; any other item is an issue, so indexes stay exact. */
  private objects(path: string, value: Json, maxItems?: number): [number, Obj][] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      this.add(path, "type", "must be an array");
      return [];
    }
    if (maxItems !== undefined && value.length > maxItems)
      this.add(path, "too-many", `${value.length} items, max ${maxItems}`);
    const out: [number, Obj][] = [];
    value.forEach((v, i) => {
      if (isObject(v)) out.push([i, v]);
      else this.add(`${path}[${i}]`, "type", "must be an object");
    });
    return out;
  }

  /** file:line or file:first-last, inside a hunk of a changed file (so the report can show it). */
  private location(path: string, value: Json, required: boolean) {
    if (isHole(value)) return;
    if (value === undefined || value === null || value === "") {
      if (required) this.add(path, "required", "required (file:line inside a hunk)");
      return;
    }
    const m = LOCATION_RE.exec(String(value));
    if (!m) return this.add(path, "location", `'${String(value)}' must be 'file:line' or 'file:first-last'`);
    const [file, a] = [m[1] as string, Number(m[2])];
    const b = Number(m[3] ?? m[2]);
    const f = this.files.get(file);
    if (!f) return this.add(path, "location", `file '${file}' is not part of this change`);
    const ranges = hunkRanges(f);
    if (f.hunks.length && !ranges.some(([lo, hi]) => a <= hi && b >= lo)) {
      this.add(
        path,
        "location",
        `${a}-${b} is outside the hunks of ${file} (${ranges.map(([lo, hi]) => `${lo}-${hi}`).join(", ")})`,
      );
    }
  }

  // ── sections ──

  private header(e: Obj) {
    for (const k of Object.keys(e)) {
      if (!(EXPLANATION_FIELDS as string[]).includes(k)) {
        this.add(k, "unknown-field", `unknown field (allowed: ${EXPLANATION_FIELDS.join(", ")})`);
      }
    }
    if (e.version !== CONTRACT_VERSION)
      this.add("version", "not-allowed", `'${String(e.version)}' must be ${CONTRACT_VERSION}`);
    if (e.key !== this.facts.key) {
      this.add("key", "stale", `'${String(e.key)}' is not this change's key '${this.facts.key}'`);
    }
    const lang = this.facts.config.lang;
    if (e.lang !== lang)
      this.add(
        "lang",
        "not-allowed",
        `'${String(e.lang)}' must be '${lang}', the report language; write the prose in it`,
      );
  }

  private components(value: Json) {
    const changed = changedComponents(this.facts);
    const described = new Set<string>();
    for (const [i, c] of this.objects("components", value)) {
      const id = c.id as string;
      if (isHole(id)) {
        // the placeholder issue says it
      } else if (!changed.includes(id)) {
        this.add(
          `components[${i}].id`,
          "unknown-id",
          `'${String(id)}' is not a changed component (use: ${changed.join(", ")})`,
        );
      } else if (described.has(id)) this.add(`components[${i}].id`, "duplicate", `'${id}' is described twice`);
      described.add(id);
      this.text(`components[${i}].summary`, c.summary, LIMITS["components.summary"]);
    }
    const missing = changed.filter((id) => !described.has(id));
    if (missing.length) this.add("components", "missing", `missing a one-line summary for ${missing.join(", ")}`);
  }

  private decisions(value: Json) {
    for (const [i, d] of this.objects("decisions", value, LIMITS.decisions)) {
      this.text(`decisions[${i}].title`, d.title, LIMITS["decisions.title"]);
      this.text(`decisions[${i}].why`, d.why, LIMITS["decisions.why"]);
      this.basis(`decisions[${i}]`, d);
      // The alternative is what was not built: it may name code that is not in the change.
      this.text(`decisions[${i}].alternative`, d.alternative, LIMITS["decisions.alternative"], {
        required: false,
        names: false,
      });
      this.location(`decisions[${i}].evidence`, d.evidence, false);
    }
  }

  /** The why's source must exist in this change: a PR description, an OpenSpec change, or the code at the evidence. */
  private basis(path: string, d: Obj) {
    const at = `${path}.basis`;
    if (d.basis === undefined || d.basis === null) {
      return this.add(at, "required", `required: ${ENUMS["decisions.basis"].join(" | ")}`);
    }
    this.enumValue(at, d.basis, "decisions.basis");
    const bases = decisionBases(this.facts);
    if (d.basis === "pr" && !bases.includes("pr")) {
      this.add(at, "basis", "this change has no PR description; use code (with evidence) or inferred");
    } else if (d.basis === "spec" && !bases.includes("spec")) {
      this.add(at, "basis", "this change has no OpenSpec proposal or design; use code (with evidence) or inferred");
    } else if (d.basis === "code" && (d.evidence === undefined || d.evidence === null || d.evidence === "")) {
      this.add(at, "basis", "code needs evidence: the file:line that shows the why");
    }
  }

  /** Returns the steps of each flow by id, for the story's flow views. */
  private flows(value: Json): Map<string, Obj[]> {
    const scenarios = new Set(specRequirements(this.facts).flatMap((r) => r.scenarios.map((s) => `${r.id}#${s.id}`)));
    const flowSteps = new Map<string, Obj[]>();
    const titles = new Set<string>();
    for (const [i, fl] of this.objects("flows", value, LIMITS.flows)) {
      const id = String(fl.id ?? "");
      if (isHole(id)) {
        // the placeholder issue says it
      } else if (!KEBAB_RE.test(id)) this.add(`flows[${i}].id`, "type", `'${id}' must be kebab-case`);
      else if (flowSteps.has(id)) this.add(`flows[${i}].id`, "duplicate", `'${id}' is used twice`);
      this.flowTitle(`flows[${i}].title`, fl.title, titles);
      this.trigger(`flows[${i}].trigger`, fl.trigger);
      if (
        fl.scenario !== undefined &&
        fl.scenario !== null &&
        !isHole(fl.scenario) &&
        !scenarios.has(fl.scenario as string)
      ) {
        const known = [...scenarios].sort().slice(0, 12).join(", ") || "none";
        this.add(
          `flows[${i}].scenario`,
          "unknown-id",
          `'${String(fl.scenario)}' is not a scenario of this change (use '<requirement-id>#<scenario-id>': ${known})`,
        );
      }
      if (!Array.isArray(fl.steps) || !fl.steps.length) {
        if (!flowSteps.has(id)) flowSteps.set(id, []);
        this.add(`flows[${i}].steps`, "too-few", "at least one step");
        continue;
      }
      const steps = this.objects(`flows[${i}].steps`, fl.steps, LIMITS["flows.steps"]);
      if (!flowSteps.has(id))
        flowSteps.set(
          id,
          steps.map(([, s]) => s),
        );
      for (const [j, s] of steps) this.flowStep(`flows[${i}].steps[${j}]`, s);
    }
    return flowSteps;
  }

  /** The tab's name: an action, distinct from the boxes on the map and from the other flows. */
  private flowTitle(path: string, title: Json, titles: Set<string>) {
    const before = this.issues.length;
    this.text(path, title, LIMITS["flows.title"]);
    if (this.issues.length > before || typeof title !== "string") return;
    const key = title.trim().toLowerCase();
    const boxes = new Set(this.facts.config.components.flatMap((c) => [c.id.toLowerCase(), c.name.toLowerCase()]));
    if (boxes.has(key))
      this.add(path, "title", `'${title}' is a component's name; name the action that starts the flow`);
    else if (titles.has(key))
      this.add(path, "duplicate", `'${title}' is used by another flow; say what sets them apart`);
    else if (title.trimEnd().endsWith(".")) this.add(path, "title", "a title, not a sentence: drop the final '.'");
    titles.add(key);
  }

  /** The code that starts the flow, exactly as written: a handler, a job, a command or a route. */
  private trigger(path: string, value: Json) {
    if (value === undefined || value === null || isHole(value)) return;
    if (typeof value !== "string" || !value.trim() || cpLength(value) > LIMITS["flows.trigger"]) {
      return this.add(
        path,
        "type",
        `the code that starts the flow, like 'OrdersController#create' or 'POST /orders' (max ${LIMITS["flows.trigger"]} chars)`,
      );
    }
    const verbs = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
    const unknown = (value.match(/[A-Za-z_][\w?!]*/g) ?? []).filter(
      (w) => !verbs.has(w) && w.length > 2 && !this.prose.known(w),
    );
    if (unknown.length)
      this.add(
        path,
        "unknown-code-name",
        `${unknown.join(", ")} not found in the change; write the trigger as in the code`,
      );
  }

  private flowStep(path: string, s: Obj) {
    for (const end of ["from", "to"] as const) {
      if (!isHole(s[end]) && !this.componentIds.has(s[end] as string)) {
        this.add(
          `${path}.${end}`,
          "unknown-id",
          `'${String(s[end])}' is not a component of this change (use: ${explainableComponents(this.facts).join(", ")})`,
        );
      }
    }
    this.text(`${path}.call`, s.call, LIMITS["flows.steps.call"]);
    this.enumValue(`${path}.delta`, s.delta, "flows.steps.delta");
    const data = s.data;
    if (data === undefined || data === null) return;
    if (!isObject(data)) return this.add(`${path}.data`, "type", "must be an object {type, fields}");
    this.text(`${path}.data.type`, data.type, LIMITS["flows.steps.data.type"], { names: false });
    this.fields(
      `${path}.data.fields`,
      data.fields,
      LIMITS["flows.steps.data.fields"],
      LIMITS["flows.steps.data.fields.item"],
    );
  }

  /** The entities and relations the change touches. Returns the entity ids, for the story's data view. */
  private dataModel(value: Json): Set<string> {
    let dm: Obj | null = null;
    if (value !== undefined && value !== null) {
      if (isObject(value)) dm = value;
      else this.add("dataModel", "type", "must be an object {entities, relations}");
    }
    const ids = new Set<string>();
    for (const [i, en] of this.objects("dataModel.entities", dm?.entities, LIMITS["dataModel.entities"])) {
      const path = `dataModel.entities[${i}]`;
      const id = String(en.id ?? "");
      if (isHole(id)) {
        // the placeholder issue says it
      } else if (!KEBAB_RE.test(id)) this.add(`${path}.id`, "type", `'${id}' must be kebab-case`);
      else if (ids.has(id)) this.add(`${path}.id`, "duplicate", `'${id}' is used twice`);
      ids.add(id);
      this.text(`${path}.name`, en.name, LIMITS["dataModel.entities.name"], { names: false });
      this.enumValue(`${path}.delta`, en.delta, "dataModel.entities.delta");
      this.fields(
        `${path}.fields`,
        en.fields,
        LIMITS["dataModel.entities.fields"],
        LIMITS["dataModel.entities.fields.item"],
      );
      if (
        en.component !== undefined &&
        en.component !== null &&
        !isHole(en.component) &&
        !this.componentIds.has(en.component as string)
      ) {
        this.add(`${path}.component`, "unknown-id", `'${String(en.component)}' is not a component`);
      }
      this.location(`${path}.evidence`, en.evidence, en.delta !== "unchanged");
    }
    for (const [i, rl] of this.objects("dataModel.relations", dm?.relations, LIMITS["dataModel.relations"])) {
      for (const end of ["from", "to"] as const) {
        if (!isHole(rl[end]) && !ids.has(rl[end] as string)) {
          this.add(
            `dataModel.relations[${i}].${end}`,
            "unknown-id",
            `'${String(rl[end])}' is not an entity (use: ${[...ids].sort().join(", ") || "none"})`,
          );
        }
      }
      this.text(`dataModel.relations[${i}].label`, rl.label, LIMITS["dataModel.relations.label"], { required: false });
      this.enumValue(`dataModel.relations[${i}].delta`, rl.delta, "dataModel.relations.delta");
    }
    return ids;
  }

  /** Every ADDED or MODIFIED requirement must be mapped to the code (or declared missing). */
  private requirements(value: Json) {
    const covered = new Set<string>();
    for (const [i, r] of this.objects("requirements", value, LIMITS.requirements)) {
      const id = r.id as string;
      if (!this.requirementIds.includes(id)) {
        this.add(
          `requirements[${i}].id`,
          "unknown-id",
          `'${String(id)}' is not a requirement of this change (use: ${this.requirementIds.join(", ") || "none"})`,
        );
      } else if (covered.has(id)) this.add(`requirements[${i}].id`, "duplicate", `'${id}' is mapped twice`);
      covered.add(id);
      this.enumValue(`requirements[${i}].status`, r.status, "requirements.status");
      const comps = r.components ?? [];
      const tests = r.tests ?? [];
      if (!Array.isArray(comps) || !Array.isArray(tests)) {
        this.add(`requirements[${i}]`, "type", "components and tests must be arrays");
        continue;
      }
      if (comps.length > LIMITS["requirements.components"]) {
        this.add(
          `requirements[${i}].components`,
          "too-many",
          `${comps.length} items, max ${LIMITS["requirements.components"]}`,
        );
      }
      if (tests.length > LIMITS["requirements.tests"]) {
        this.add(`requirements[${i}].tests`, "too-many", `${tests.length} items, max ${LIMITS["requirements.tests"]}`);
      }
      for (const c of comps) {
        if (!isHole(c) && !this.componentIds.has(c as string)) {
          this.add(
            `requirements[${i}].components`,
            "unknown-id",
            `'${String(c)}' is not a component (use: ${explainableComponents(this.facts).join(", ")})`,
          );
        }
      }
      for (const t of tests) {
        if (isHole(t)) continue;
        const path = String(t).replace(/:\d+(?:-\d+)?$/, "");
        if (!this.files.has(path) && !(this.root && existsSync(join(this.root, path)))) {
          this.add(`requirements[${i}].tests`, "unknown-id", `'${path}' does not exist`);
        }
      }
      if (r.status === "implemented" && !comps.length && !tests.length) {
        this.add(`requirements[${i}]`, "missing", "'implemented' needs at least one component or test");
      }
      this.text(`requirements[${i}].note`, r.note, LIMITS["requirements.note"], {
        required: r.status === "partial" || r.status === "missing",
      });
    }
    const unmapped = mappableRequirements(this.facts)
      .map((r) => r.id)
      .filter((id) => !covered.has(id));
    if (unmapped.length) {
      this.add(
        "requirements",
        "missing",
        `map every ADDED or MODIFIED requirement to its implementation; missing ${unmapped.join(", ")}`,
      );
    }
  }

  private keyDependencies(value: Json) {
    const drawn = new Set(this.facts.dependencies.map((e) => `${e.from}\0${e.to}`));
    for (const [i, k] of this.objects("keyDependencies", value, LIMITS.keyDependencies)) {
      if (!isHole(k.from) && !isHole(k.to) && !drawn.has(`${String(k.from)}\0${String(k.to)}`)) {
        const list =
          this.facts.dependencies
            .map((e) => `${e.from} -> ${e.to}`)
            .sort()
            .slice(0, 15)
            .join(", ") || "none";
        this.add(
          `keyDependencies[${i}]`,
          "unknown-id",
          `${String(k.from)} -> ${String(k.to)} is not a dependency drawn for this change (use one of: ${list})`,
        );
      }
      this.text(`keyDependencies[${i}].label`, k.label, LIMITS["keyDependencies.label"], { required: false });
    }
  }

  private story(value: Json, flowSteps: Map<string, Obj[]>, entityIds: Set<string>) {
    const steps = this.objects("story", value, LIMITS.story);
    if (this.facts.components.length && steps.length < STORY_MIN) {
      this.add(
        "story",
        "too-few",
        `${steps.length} steps; write ${STORY_MIN}-${LIMITS.story} steps, the headline change first`,
      );
    }
    for (const [i, step] of steps) {
      this.text(`story[${i}].heading`, step.heading, LIMITS["story.heading"]);
      this.text(`story[${i}].body`, step.body, LIMITS["story.body"]);
      let focus = step.focus ?? [];
      if (!Array.isArray(focus)) {
        this.add(`story[${i}].focus`, "type", "must be an array");
        focus = [];
      }
      const ids = focus as Json[];
      if (ids.length > LIMITS["story.focus"]) {
        this.add(
          `story[${i}].focus`,
          "too-many",
          `${ids.length} items, max ${LIMITS["story.focus"]}; light the change, not the whole map`,
        );
      }
      const view = String(step.view ?? "architecture");
      const allowed = this.viewIds(`story[${i}].view`, view, flowSteps, entityIds);
      if (!allowed) continue;
      for (const x of ids) {
        if (!isHole(x) && !allowed.ids.has(x as string)) {
          this.add(`story[${i}].focus`, "unknown-id", `'${String(x)}' is not on view '${view}' (use: ${allowed.hint})`);
        }
      }
      this.location(`story[${i}].code`, step.code, false);
    }
  }

  /** The ids a story step may focus on its view, with a hint for errors; null (and an issue) for an unknown view. */
  private viewIds(path: string, view: string, flowSteps: Map<string, Obj[]>, entityIds: Set<string>) {
    if (view === "architecture") {
      return {
        ids: new Set(this.facts.components.map((c) => c.id)),
        hint: this.facts.components.map((c) => c.id).join(", "),
      };
    }
    if (view.startsWith("flow:")) {
      const steps = flowSteps.get(view.slice(5));
      if (!steps) {
        const known = [...flowSteps.keys()].map((f) => `flow:${f}`).join(", ") || "none";
        this.add(path, "unknown-id", `'${view}' names no flow (use: ${known})`);
        return null;
      }
      const ids = new Set<string>([
        ...steps.flatMap((s) => [s.from as string, s.to as string]),
        ...steps.map((_, n) => `#${n + 1}`),
      ]);
      return { ids, hint: `participants or step numbers #1-#${steps.length}` };
    }
    if (view === "data" && entityIds.size) return { ids: entityIds, hint: "entity ids" };
    if (view === "requirements" && this.requirementIds.length) {
      return { ids: new Set([...this.requirementIds, ...this.componentIds]), hint: "requirement ids or component ids" };
    }
    this.add(
      path,
      "not-allowed",
      `'${view}' must be architecture | flow:<id>` +
        (entityIds.size ? " | data" : "") +
        (this.requirementIds.length ? " | requirements" : ""),
    );
    return null;
  }
}
