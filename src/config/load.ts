import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { z } from "zod";
import { type Config, RawConfigSchema, type ReferenceFlow } from "../contract/config.ts";
import { CONFIG_NAME, DEFAULT_BUDGET, DEFAULT_IGNORE, DEFAULT_TESTS } from "../core/constants.ts";
import { UserError } from "../core/errors.ts";

export interface LoadedConfig {
  config: Config;
  errors: string[];
}

const ARROW_RE = /^\s*([\w.-]+)\s*->\s*([\w.-]+)\s*(?::\s*([\s\S]*))?$/;

export function parseArrow(text: string): { from: string; to: string; message: string } | null {
  const m = ARROW_RE.exec(text);
  return m ? { from: m[1] as string, to: m[2] as string, message: (m[3] ?? "").trim() } : null;
}

/** "components[2].layer" from a zod issue path. */
export function issuePath(path: readonly PropertyKey[]): string {
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : i ? `.${String(p)}` : String(p))).join("");
}

export function zodErrors(error: z.ZodError): string[] {
  return error.issues.map((i) => {
    const where = issuePath(i.path);
    const keys = i.code === "unrecognized_keys" ? `: ${i.keys.join(", ")}` : "";
    return `${where || "config"}: ${i.code === "unrecognized_keys" ? "unknown key" : i.message}${keys}`;
  });
}

/** The config file, or one inferred from the folder layout when there is none. Errors make the config unusable. */
export function loadConfig(root: string, infer: () => Config): LoadedConfig {
  const path = join(root, CONFIG_NAME);
  if (!existsSync(path)) return { config: infer(), errors: [] };
  let raw: unknown;
  try {
    raw = parseToml(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch (e) {
    throw new UserError(`${CONFIG_NAME}: ${(e as Error).message}`);
  }
  return normalizeConfig(raw, false);
}

/** Validates a raw config (TOML or inferred) and resolves its cross-references. */
export function normalizeConfig(raw: unknown, inferred: boolean): LoadedConfig {
  const config: Config = {
    inferred,
    name: "",
    direction: "",
    lang: "en",
    base: "",
    host: null,
    budget: DEFAULT_BUDGET,
    names: [],
    layers: [],
    components: [],
    rules: { allow: [], forbid: [], sameLayer: true },
    flows: [],
    glossary: [],
    ignore: { paths: [...DEFAULT_IGNORE], tests: [...DEFAULT_TESTS] },
  };
  const parsed = RawConfigSchema.safeParse(raw);
  if (!parsed.success) return { config, errors: zodErrors(parsed.error) };
  const r = parsed.data;
  const errors: string[] = [];
  Object.assign(config, {
    name: r.project?.name ?? "",
    direction: r.project?.direction ?? "",
    lang: r.project?.lang ?? "en",
    base: r.project?.base ?? "",
    host: r.project?.host ?? null,
    budget: r.project?.budget ?? DEFAULT_BUDGET,
    names: [...new Set(r.project?.names ?? [])].sort(),
  });
  const layerIds = new Set<string>();
  (r.layers ?? []).forEach((layer, i) => {
    if (layerIds.has(layer.id)) errors.push(`layers[${i}].id: '${layer.id}' is declared twice`);
    else {
      layerIds.add(layer.id);
      config.layers.push({ id: layer.id, name: layer.name ?? layer.id });
    }
  });
  const componentIds = new Set<string>();
  (r.components ?? []).forEach((c, i) => {
    if (componentIds.has(c.id)) {
      errors.push(`components[${i}].id: '${c.id}' is declared twice`);
      return;
    }
    // Rules name layers and components alike: an id may be both only when the component lives in that layer.
    if (layerIds.has(c.id) && c.layer !== c.id) {
      errors.push(
        `components[${i}].id: '${c.id}' is a layer too, and the component is in layer '${c.layer}'; rename one`,
      );
      return;
    }
    if (!layerIds.has(c.layer)) {
      errors.push(`components[${i}] '${c.id}': layer '${c.layer}' is not declared in [[layers]]`);
      return;
    }
    const paths = typeof c.paths === "string" ? [c.paths] : c.paths;
    if (!paths.length) errors.push(`components[${i}] '${c.id}': paths is empty`);
    componentIds.add(c.id);
    config.components.push({
      id: c.id,
      name: c.name ?? c.id,
      layer: c.layer,
      desc: c.desc ?? "",
      paths,
      imports: c.imports ?? [],
      namespaces: c.namespaces ?? [],
      constants: c.constants ?? [],
    });
  });
  const names = new Set([...layerIds, ...componentIds]);
  for (const key of ["allow", "forbid"] as const) {
    (r.rules?.[key] ?? []).forEach((rule, j) => {
      const arrow = parseArrow(rule);
      if (!arrow || !names.has(arrow.from) || !names.has(arrow.to)) {
        errors.push(`rules.${key}[${j}]: '${rule}' must be 'a -> b' with layer or component ids`);
      } else config.rules[key].push([arrow.from, arrow.to]);
    });
  }
  config.rules.sameLayer = r.rules?.same_layer ?? true;
  const flowIds = new Set<string>();
  (r.flows ?? []).forEach((fl, i) => {
    if (flowIds.has(fl.id)) errors.push(`flows[${i}].id: '${fl.id}' is declared twice`);
    flowIds.add(fl.id);
    const flow: ReferenceFlow = { id: fl.id, title: fl.title ?? fl.id, steps: [] };
    fl.steps.forEach((s, j) => {
      const arrow = parseArrow(s);
      if (!arrow || !componentIds.has(arrow.from) || !componentIds.has(arrow.to)) {
        errors.push(`flows[${i}].steps[${j}]: '${s}' must be 'componentA -> componentB : message' with component ids`);
      } else flow.steps.push(arrow);
    });
    config.flows.push(flow);
  });
  config.glossary = Object.entries(r.glossary ?? {}).map(([term, definition]) => ({ term, definition }));
  if (r.ignore?.paths) config.ignore.paths = r.ignore.paths;
  if (r.ignore?.tests) config.ignore.tests = r.ignore.tests;
  return { config, errors };
}
