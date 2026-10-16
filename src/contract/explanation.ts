import { z } from "zod";
import { CONTRACT_VERSION } from "../core/constants.ts";
import { LANGS } from "./config.ts";
import { DELTAS, Location, View } from "./facts.ts";

/**
 * explanation.json: the only thing the agent writes. The CLI drafts it from the facts (ids, views, focus, code
 * references and evidence are already right) and the agent replaces each "<…>" placeholder with its words.
 * LIMITS and ENUMS are the single source of the contract: this schema, the validator and the digest's rules are
 * built from them.
 */

export const LIMITS = {
  tldr: 280,
  goal: 200,
  story: 8,
  "story.heading": 60,
  "story.body": 160,
  "story.focus": 6,
  keyDependencies: 2,
  "keyDependencies.label": 40,
  "components.summary": 140,
  decisions: 5,
  "decisions.title": 80,
  "decisions.why": 200,
  "decisions.alternative": 140,
  flows: 3,
  "flows.title": 60,
  "flows.trigger": 60,
  "flows.steps": 12,
  "flows.steps.call": 80,
  "flows.steps.data.type": 40,
  "flows.steps.data.fields": 8,
  "flows.steps.data.fields.item": 60,
  "dataModel.entities": 12,
  "dataModel.entities.name": 40,
  "dataModel.entities.fields": 12,
  "dataModel.entities.fields.item": 60,
  "dataModel.relations": 16,
  "dataModel.relations.label": 30,
  requirements: 80,
  "requirements.components": 6,
  "requirements.tests": 4,
  "requirements.note": 160,
} as const;
export const STORY_MIN = 2;

export const REQUIREMENT_STATUSES = ["implemented", "partial", "missing", "not-applicable"] as const;
export const ENUMS = {
  "flows.steps.delta": DELTAS,
  "dataModel.entities.delta": DELTAS,
  "dataModel.relations.delta": DELTAS,
  "requirements.status": REQUIREMENT_STATUSES,
} as const;

export const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const text = (limit: number, description: string) => z.string().min(1).max(limit).describe(description);
const FIELD_HELP = "'+email: string' added, '-fax' removed, '~total: number' changed, 'id: string' unchanged.";

export const ExplanationSchema = z
  .strictObject({
    version: z.literal(CONTRACT_VERSION),
    key: z.string().describe("The change key from the draft. Another key means the explanation is stale."),
    lang: z.enum(LANGS).describe("The report language: write all prose in it."),
    tldr: text(LIMITS.tldr, "What changes and its effect."),
    goal: text(LIMITS.goal, "The need or problem behind the change; not a repeat of tldr."),
    story: z
      .array(
        z.strictObject({
          heading: text(LIMITS["story.heading"], "The thing and what happened to it (added, removed, now, moved)."),
          body: text(LIMITS["story.body"], "What behaves differently now; not a description of the code."),
          view: View.optional(),
          focus: z
            .array(z.string())
            .max(LIMITS["story.focus"])
            .describe(
              "Ids on the view: components; on a flow, participants or step numbers '#2'; entity ids; requirement ids.",
            )
            .optional(),
          code: Location.describe("file:first-last inside a hunk, shown beside the step.").optional(),
        }),
      )
      .min(STORY_MIN)
      .max(LIMITS.story)
      .describe("The guided tour over the map. One step = one change, headline first, overview last."),
    keyDependencies: z
      .array(
        z.strictObject({
          from: z.string(),
          to: z.string(),
          label: z.string().max(LIMITS["keyDependencies.label"]).optional(),
        }),
      )
      .max(LIMITS.keyDependencies)
      .describe("The dependency (a drawn arrow) the change is really about.")
      .optional(),
    components: z
      .array(
        z.strictObject({
          id: z.string(),
          summary: text(LIMITS["components.summary"], "What it now does differently."),
        }),
      )
      .describe("One line per changed component; every changed component needs one."),
    decisions: z
      .array(
        z.strictObject({
          title: text(LIMITS["decisions.title"], "The choice."),
          why: text(LIMITS["decisions.why"], "Why this choice."),
          alternative: z
            .string()
            .max(LIMITS["decisions.alternative"])
            .describe("The main alternative not built.")
            .optional(),
          evidence: Location.describe("Where the code shows it: file:line inside a hunk.").optional(),
        }),
      )
      .max(LIMITS.decisions)
      .optional(),
    flows: z
      .array(
        z.strictObject({
          id: z.string().regex(KEBAB_RE).describe("kebab-case; the id of a reference flow compares it with that flow."),
          title: text(LIMITS["flows.title"], "The action that starts it, verb first: 'Create a partial refund'."),
          trigger: z
            .string()
            .max(LIMITS["flows.trigger"])
            .describe("The code that starts it: 'RefundsController#create'.")
            .optional(),
          scenario: z
            .string()
            .regex(/^[^#]+#[a-z0-9-]+$/)
            .describe("The OpenSpec scenario this flow realizes: <requirement-id>#<scenario-id>.")
            .optional(),
          steps: z
            .array(
              z.strictObject({
                from: z.string(),
                to: z.string(),
                call: text(
                  LIMITS["flows.steps.call"],
                  "The call as the code makes it ('Refund.create!'), or a short verb phrase.",
                ),
                delta: z.enum(DELTAS),
                data: z
                  .strictObject({
                    type: text(LIMITS["flows.steps.data.type"], "The type a reader of the code knows."),
                    fields: z
                      .array(z.string().min(1).max(LIMITS["flows.steps.data.fields.item"]).describe(FIELD_HELP))
                      .max(LIMITS["flows.steps.data.fields"])
                      .optional(),
                  })
                  .describe("What travels on this step, when it changed.")
                  .optional(),
              }),
            )
            .min(1)
            .max(LIMITS["flows.steps"]),
        }),
      )
      .max(LIMITS.flows)
      .optional(),
    dataModel: z
      .strictObject({
        entities: z
          .array(
            z.strictObject({
              id: z.string().regex(KEBAB_RE),
              name: text(LIMITS["dataModel.entities.name"], "The model or table name."),
              delta: z.enum(DELTAS),
              component: z.string().optional(),
              fields: z
                .array(z.string().min(1).max(LIMITS["dataModel.entities.fields.item"]).describe(FIELD_HELP))
                .max(LIMITS["dataModel.entities.fields"])
                .optional(),
              evidence: Location.describe(
                "A model or migration hunk; required unless delta is 'unchanged'.",
              ).optional(),
            }),
          )
          .max(LIMITS["dataModel.entities"]),
        relations: z
          .array(
            z.strictObject({
              from: z.string(),
              to: z.string(),
              label: z.string().max(LIMITS["dataModel.relations.label"]).optional(),
              delta: z.enum(DELTAS),
            }),
          )
          .max(LIMITS["dataModel.relations"]),
      })
      .describe("The entities and relations the change touches.")
      .optional(),
    requirements: z
      .array(
        z.strictObject({
          id: z.string().describe("A requirement id from the facts: <capability>/<kebab-name>."),
          status: z.enum(REQUIREMENT_STATUSES),
          components: z.array(z.string()).max(LIMITS["requirements.components"]).optional(),
          tests: z
            .array(z.string())
            .max(LIMITS["requirements.tests"])
            .describe("path or path:line of a test that proves it.")
            .optional(),
          note: z.string().max(LIMITS["requirements.note"]).describe("Required for partial and missing.").optional(),
        }),
      )
      .max(LIMITS.requirements)
      .describe("OpenSpec traceability: one entry per ADDED or MODIFIED requirement.")
      .optional(),
  })
  .describe("explanation.json: what the agent writes about one change.");

export type Explanation = z.infer<typeof ExplanationSchema>;
export type StoryStep = Explanation["story"][number];
export type ExplainedFlow = NonNullable<Explanation["flows"]>[number];
export type DataModel = NonNullable<Explanation["dataModel"]>;
export const EXPLANATION_FIELDS = Object.keys(ExplanationSchema.shape) as (keyof Explanation)[];

/**
 * The explanation as the report reads it: validated, with optional parts filled in, lists in a stable order, and
 * each flow step marked verified (or not) against the code's dependencies.
 */
export interface NormalizedExplanation extends Omit<Explanation, "flows" | "story"> {
  story: (StoryStep & { view: string; focus: string[] })[];
  keyDependencies: NonNullable<Explanation["keyDependencies"]>;
  decisions: NonNullable<Explanation["decisions"]>;
  flows: (Omit<ExplainedFlow, "steps"> & {
    steps: (ExplainedFlow["steps"][number] & { verified: boolean; via: string | null })[];
  })[];
  dataModel: DataModel;
  requirements: NonNullable<Explanation["requirements"]>;
}
