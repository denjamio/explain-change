import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { schemaFiles } from "../scripts/build.ts";
import { normalizeConfig } from "../src/config/load.ts";
import { ENUMS, EXPLANATION_FIELDS, LIMITS } from "../src/contract/explanation.ts";
import { jsonSchema } from "../src/contract/schemas.ts";
import { ROOT } from "./helpers.ts";

type Node = {
  type?: string;
  properties?: Record<string, Node>;
  items?: Node;
  maxLength?: number;
  maxItems?: number;
  enum?: string[];
};

/** "flows.steps.call" → the schema node; arrays are entered through their items, "item" names the item itself. */
function node(path: string): Node {
  const schema = jsonSchema("explanation") as Node;
  const parts = path.split(".");
  let cur = schema.properties?.[parts[0] as string] as Node;
  for (const part of parts.slice(1)) {
    if (cur.items) cur = cur.items;
    if (part !== "item") cur = cur.properties?.[part] as Node;
  }
  return cur;
}

describe("the contract", () => {
  test("the committed schemas are up to date (bun scripts/build.ts --schemas)", async () => {
    for (const [file, text] of Object.entries(await schemaFiles())) {
      expect(readFileSync(join(ROOT, "schemas", file), "utf8")).toBe(text);
    }
  });

  test("the explanation schema carries the validator's fields, limits and values", () => {
    expect(Object.keys((jsonSchema("explanation") as Node).properties ?? {}).sort()).toEqual(
      [...EXPLANATION_FIELDS].sort(),
    );
    for (const [path, limit] of Object.entries(LIMITS)) {
      const n = node(path);
      expect(n.type === "array" ? n.maxItems : n.maxLength).toBe(limit);
    }
    for (const [path, values] of Object.entries(ENUMS)) expect(node(path).enum).toEqual([...values]);
  });
});

describe("the release", () => {
  test("package.json, the plugin and the changelog name the same version", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const plugin = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/plugin.json"), "utf8"));
    expect(plugin.version).toBe(pkg.version);
    expect(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8")).toContain(`## [${pkg.version}]`);
  });

  test("the README links by absolute URL, so the npm page shows the same images and pages as GitHub", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const relative = [...readme.matchAll(/\]\(([^)\s]+)\)|src="([^"]+)"/g)]
      .map((m) => m[1] ?? m[2])
      .filter((url) => !/^(https?:|#|mailto:)/.test(url as string));
    expect(relative).toEqual([]);
  });

  test("the example config loads without errors", () => {
    const raw = parseToml(readFileSync(join(ROOT, "examples/explain-change.toml"), "utf8"));
    expect(normalizeConfig(raw, false).errors).toEqual([]);
  });
});
