import { DEFAULT_IGNORE, DEFAULT_TESTS } from "../core/constants.ts";
import { type LayoutKind, STRUCTURE_RULES, type Structure, structureLayers } from "./infer.ts";

const tomlString = (s: string) => JSON.stringify(s);
const tomlList = (items: readonly string[]) => `[${items.map(tomlString).join(", ")}]`;

/** The override key that fits each layout, shown commented out under every component. */
const OWNERSHIP_HINTS: Record<LayoutKind, string> = {
  rails: '# constants = ["Billing::*"]   # Ruby constants this component owns outside its paths',
  django: '# imports = ["billing.*"]      # dotted modules this component owns outside its paths',
  generic: '# imports = ["@app/orders/*"]  # import specifiers this component owns outside its paths',
};

/** The commented .explain-change.toml that `init` writes for a detected structure. */
export function draftConfig(name: string, structure: Structure): string {
  const layers = structureLayers(structure);
  const layerIds = new Set(layers.map(([id]) => id));
  const rules = STRUCTURE_RULES[structure.kind].filter((r) => r.split("->").every((x) => layerIds.has(x.trim())));
  const lines = [
    "# explain-change config: the source of truth for the map's layers, components and rules.",
    `# Drafted by \`explain-change init\` from a ${structure.kind} layout. Review every section, then run \`explain-change check\`.`,
    "# Layers are drawn top to bottom in this order (entry points first, core last); [rules] decides what may depend on what.",
    "# Rename, merge or split layers and components so the map reads the way the team talks about the app.",
    "# A file belongs to the component with the most specific matching path.",
    "",
    "[project]",
    `name = ${tomlString(name)}`,
    'direction = ""  # one or two sentences: the architecture you want changes to follow',
    "",
  ];
  for (const [id, layerName] of layers)
    lines.push("[[layers]]", `id = ${tomlString(id)}`, `name = ${tomlString(layerName)}`, "");
  lines.push(
    "[rules]",
    "# Allowed dependency directions (layer or component ids). With `allow`, any other edge between layers is a violation.",
    "# Suggested for this layout; uncomment once the components below are right.",
    rules.length ? `# allow = ${tomlList(rules)}` : "# allow = []",
    "same_layer = true",
    "",
  );
  for (const c of structure.components) {
    lines.push(
      "[[components]]",
      `id = ${tomlString(c.id)}`,
      ...(c.name ? [`name = ${tomlString(c.name)}`] : []),
      `layer = ${tomlString(c.layer)}`,
      `paths = ${tomlList(c.paths)}`,
      `desc = ${tomlString(c.desc)}`,
      OWNERSHIP_HINTS[structure.kind],
      "",
    );
  }
  lines.push(
    "# [[flows]]  # reference runtime flows; an explained flow with the same id is compared with it",
    '# id = "checkout"',
    '# title = "Checkout"',
    '# steps = ["controllers -> services : PlaceOrder", "services -> models : Order.create!"]',
    "",
    "# [glossary]  # the team's ubiquitous language: name components and flows with these terms",
    '# refund = "Money returned to a customer for an order, in part or in full"',
    "",
    "[ignore]  # each list replaces its default",
    `paths = ${tomlList(DEFAULT_IGNORE)}`,
    `tests = ${tomlList(DEFAULT_TESTS)}`,
    "",
  );
  return lines.join("\n");
}
