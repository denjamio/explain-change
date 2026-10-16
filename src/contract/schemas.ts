import { z } from "zod";
import { REPOSITORY } from "../core/constants.ts";
import { RawConfigSchema } from "./config.ts";
import { ExplanationSchema } from "./explanation.ts";
import { FactsSchema } from "./facts.ts";

/** The JSON Schemas of the contract, for editors and other tools; `explain-change schema <name>` prints one. */
export const SCHEMAS = {
  config: RawConfigSchema,
  facts: FactsSchema,
  explanation: ExplanationSchema,
} as const;
export type SchemaName = keyof typeof SCHEMAS;

export function jsonSchema(name: SchemaName): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://raw.githubusercontent.com/${REPOSITORY}/main/schemas/${name}.schema.json`,
    ...z.toJSONSchema(SCHEMAS[name], { target: "draft-2020-12", unrepresentable: "any" }),
  };
}
