import { z } from "zod";
import { BUDGET_RANGE, DEFAULT_BUDGET } from "../core/constants.ts";

/**
 * `.explain-change.toml`, as the team writes it. The TOML keys stay snake_case (TOML convention); everything the
 * tool writes (facts.json, explanation.json) is camelCase. `explain-change check` validates the cross-references
 * this schema cannot express: layers of components, ids in rules and flows.
 */

/** Report languages: English only for now (the prose rules exist for it alone). */
export const LANGS = ["en"] as const;
export type ReportLang = (typeof LANGS)[number];

/** Where pull requests live: the hosts `pr` and `share` work with. */
export const HOST_IDS = ["azure-devops", "github"] as const;
export type HostId = (typeof HOST_IDS)[number];

const ID_RE = /^[\w.-]+$/;
const RULE_RE = /^\s*[\w.-]+\s*->\s*[\w.-]+\s*$/;
const FLOW_STEP_RE = /^\s*[\w.-]+\s*->\s*[\w.-]+\s*(?::[\s\S]*)?$/;
const strings = (description: string) => z.array(z.string()).describe(description);

export const RawConfigSchema = z
  .strictObject({
    project: z
      .strictObject({
        name: z.string().describe("Shown in the report. Default: the repository folder name.").optional(),
        direction: z
          .string()
          .describe("One or two sentences on the intended architecture: context for the story and the decisions.")
          .optional(),
        lang: z
          .enum(LANGS, { error: "must be 'en': reports are written in English" })
          .describe("Report language: en (the default and only one).")
          .optional(),
        base: z
          .string()
          .describe("Default base ref for `local` (else origin/HEAD, origin/main, origin/master, main, master…).")
          .optional(),
        host: z
          .enum(HOST_IDS, { error: `must be ${HOST_IDS.map((h) => `'${h}'`).join(" or ")}` })
          .describe(
            "Where the PRs live, for `pr <id>` and `share`. Default: the host of the git remotes, else azure-devops. " +
              "A PR URL always names its own host.",
          )
          .optional(),
        names: z
          .array(z.string().min(1))
          .describe(
            "Product and library names written like code (FastAPI, NestJS) that the prose may use: the validator " +
              "does not look for them in the change.",
          )
          .optional(),
        budget: z
          .int({ error: `must be an integer between ${BUDGET_RANGE[0]} and ${BUDGET_RANGE[1]} (digest characters)` })
          .min(BUDGET_RANGE[0], {
            error: `must be an integer between ${BUDGET_RANGE[0]} and ${BUDGET_RANGE[1]} (digest characters)`,
          })
          .max(BUDGET_RANGE[1], {
            error: `must be an integer between ${BUDGET_RANGE[0]} and ${BUDGET_RANGE[1]} (digest characters)`,
          })
          .describe(`Digest size in characters (default ${DEFAULT_BUDGET} ≈ 3k tokens). --budget overrides it.`)
          .optional(),
      })
      .optional(),
    layers: z
      .array(
        z.strictObject({
          id: z.string().regex(ID_RE, { error: "an id: letters, digits, '_', '.' or '-'" }),
          name: z.string().optional(),
        }),
      )
      .describe(
        "Map lanes, drawn top to bottom in this order (entry points first, core last). The order does not decide " +
          "what may depend on what: [rules] does.",
      )
      .optional(),
    rules: z
      .strictObject({
        allow: z
          .array(z.string().regex(RULE_RE, { error: "'a -> b' with layer or component ids" }))
          .describe("Allowed dependency directions. When present, any other edge between layers is a violation.")
          .optional(),
        forbid: z
          .array(z.string().regex(RULE_RE, { error: "'a -> b' with layer or component ids" }))
          .describe("Always a violation, even when `allow` matches.")
          .optional(),
        same_layer: z.boolean().describe("Allow dependencies inside a layer (default true).").optional(),
      })
      .optional(),
    components: z
      .array(
        z.strictObject({
          id: z.string().regex(ID_RE, { error: "an id: letters, digits, '_', '.' or '-'" }),
          name: z.string().describe("The name the team uses; it labels the box (about 20 characters).").optional(),
          layer: z.string(),
          desc: z.string().describe("One line: what this component owns.").optional(),
          paths: z
            .union([z.string(), z.array(z.string())])
            .describe(
              "Path globs: `*` and `?` stay inside one folder, `**` crosses folders, a plain folder covers " +
                "everything below it. A file belongs to the component with the most specific match.",
            ),
          imports: strings(
            "TypeScript/Python/require specifiers owned by this component outside its paths. `*` matches anything, " +
              "`.` and `/` included: `billing.*` covers `billing.models.invoice`.",
          ).optional(),
          namespaces: strings("C# namespaces owned by this component. `*` matches anything, `.` included.").optional(),
          constants: strings("Ruby constants owned by this component. `*` matches anything, `::` included.").optional(),
        }),
      )
      .describe("The boxes of the map. Aim for 8–20, named the way the team talks about the app.")
      .optional(),
    flows: z
      .array(
        z.strictObject({
          id: z.string().regex(ID_RE, { error: "an id: letters, digits, '_', '.' or '-'" }),
          title: z.string().optional(),
          steps: z.array(
            z.string().regex(FLOW_STEP_RE, { error: "'componentA -> componentB : message' with component ids" }),
          ),
        }),
      )
      .describe(
        "Reference flows: runtime paths the team considers central. An explained flow with the same id is compared with it.",
      )
      .optional(),
    glossary: z
      .record(z.string().min(1), z.string().min(1))
      .describe(
        "The team's ubiquitous language: term = one-line definition. Name components and flows with these terms; " +
          "the agent writes the explanation with them.",
      )
      .optional(),
    ignore: z
      .strictObject({
        paths: strings(
          "Generated or vendored files: listed apart, never analyzed. Replaces the default list.",
        ).optional(),
        tests: strings("Test file patterns. Replaces the default list.").optional(),
      })
      .optional(),
  })
  .describe("explain-change configuration (.explain-change.toml at the repository root).");

export type RawConfig = z.infer<typeof RawConfigSchema>;

/** The normalized config the analysis runs on. */
export interface Layer {
  id: string;
  name: string;
}

export interface ComponentConfig {
  id: string;
  name: string;
  layer: string;
  desc: string;
  paths: string[];
  imports: string[];
  namespaces: string[];
  constants: string[];
}

export interface FlowStepRef {
  from: string;
  to: string;
  message: string;
}

export interface ReferenceFlow {
  id: string;
  title: string;
  steps: FlowStepRef[];
}

export interface Config {
  /** True when no config file exists and layers and components were guessed from the folder layout. */
  inferred: boolean;
  name: string;
  direction: string;
  lang: ReportLang;
  base: string;
  /** Where the PRs live; null: the host of the git remotes. */
  host: HostId | null;
  budget: number;
  /** Product names written like code that the prose may use (`project.names`). */
  names: string[];
  layers: Layer[];
  components: ComponentConfig[];
  rules: { allow: [string, string][]; forbid: [string, string][]; sameLayer: boolean };
  flows: ReferenceFlow[];
  glossary: { term: string; definition: string }[];
  ignore: { paths: string[]; tests: string[] };
}
